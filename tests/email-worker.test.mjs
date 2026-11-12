import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmailHandler } from "../supabase/functions/_shared/email-worker.mjs";
const job = {
  id: "00000000-0000-4000-8000-000000000001",
  lock_token: "lease",
  payload: {
    from: "HCVA <it@example.com>",
    to: ["va@example.com"],
    cc: ["ceo@example.com", "coo@example.com", "hr@example.com"],
    subject: "Action required",
    text: "Install backup power by the reviewed deadline.",
  },
};
function setup({
  admin = true,
  tokenValid = true,
  fetchImpl,
  finishError = false,
} = {}) {
  const calls = [],
    requests = [];
  let claimed = false;
  const vars = {
    APP_ORIGIN: "https://app.example.com",
    SUPABASE_URL: "https://db.example.com",
    DEVICECARE_PUBLISHABLE_KEY: "public-test",
    DEVICECARE_SECRET_KEY: "server-test",
    CRON_SECRET: "cron-test-secret",
    RESEND_API_KEY: "resend-test",
  };
  const user = {
    auth: {
      getUser: async () => ({
        data: { user: tokenValid ? { id: "admin" } : null },
        error: null,
      }),
    },
    rpc: async (name) => {
      calls.push(["user", name]);
      return { data: admin, error: null };
    },
  };
  const service = {
    rpc: async (name, args) => {
      calls.push(["service", name, args]);
      if (name === "enqueue_action_reminders") return { data: 0, error: null };
      if (name === "claim_action_email") {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return { data: [job], error: null };
      }
      if (name === "finish_action_email")
        return {
          data: args.p_provider_id
            ? "accepted"
            : args.p_retryable
              ? "queued"
              : "failed",
          error: finishError ? { message: "DB unavailable" } : null,
        };
      throw Error(name);
    },
  };
  const fetcher =
    fetchImpl ||
    (async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: "provider-1" }), {
        status: 200,
      });
    });
  const handler = createEmailHandler({
    env: (name) => vars[name],
    createClient: (_url, key) => (key === "server-test" ? service : user),
    fetchImpl: fetcher,
  });
  const request = (
    token = "user-token",
    body = { job_id: job.id },
    origin = "https://app.example.com",
  ) =>
    new Request("https://db.example.com/functions/v1/process-action-emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  return { handler, request, calls, requests, vars };
}
test("email worker enforces real-user admin authorization before claiming jobs", async () => {
  const x = setup({ admin: false });
  const res = await x.handler(x.request());
  assert.equal(res.status, 403);
  assert.ok(!x.calls.some((c) => c[0] === "service"));
  assert.equal(x.requests.length, 0);
  const y = setup({ tokenValid: false });
  assert.equal((await y.handler(y.request())).status, 401);
  assert.equal(y.requests.length, 0);
});
test("email worker sends only a frozen queued payload and stable provider idempotency key", async () => {
  const x = setup();
  const res = await x.handler(x.request());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).accepted, 1);
  assert.equal(
    x.requests[0].options.headers["Idempotency-Key"],
    `devicecare/${job.id}`,
  );
  assert.deepEqual(JSON.parse(x.requests[0].options.body), job.payload);
  const finish = x.calls.find((c) => c[1] === "finish_action_email")[2];
  assert.equal(finish.p_provider_id, "provider-1");
  assert.equal(finish.p_lock_token, "lease");
});
test("trusted cron secret processes jobs without pretending to be a signed-in user", async () => {
  const x = setup();
  assert.equal(
    (await x.handler(x.request("cron-test-secret", {}, null))).status,
    200,
  );
  assert.ok(!x.calls.some((c) => c[0] === "user"));
  assert.equal(x.requests.length, 1);
});
test("timeouts are retryable while provider validation failures stop automatic retries", async () => {
  const x = setup({
    fetchImpl: async () => {
      throw Error("network");
    },
  });
  await x.handler(x.request());
  assert.equal(
    x.calls.find((c) => c[1] === "finish_action_email")[2].p_retryable,
    true,
  );
  const y = setup({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ message: "Sender domain is not verified" }),
        { status: 422 },
      ),
  });
  await y.handler(y.request());
  assert.equal(
    y.calls.find((c) => c[1] === "finish_action_email")[2].p_retryable,
    false,
  );
});
test("disallowed origins and missing credentials never reach the provider", async () => {
  const x = setup();
  assert.equal(
    (await x.handler(x.request("user-token", {}, "https://untrusted.example")))
      .status,
    403,
  );
  assert.equal(x.requests.length, 0);
  x.vars.RESEND_API_KEY = "";
  assert.equal((await x.handler(x.request())).status, 503);
  assert.ok(!x.calls.some((c) => c[0] === "service"));
});
test("a database error after provider acceptance does not claim a successful recorded send", async () => {
  const x = setup({ finishError: true });
  const res = await x.handler(x.request());
  assert.equal(res.status, 500);
  assert.equal(x.requests.length, 1);
  assert.ok((await res.json()).error.includes("lease"));
});
