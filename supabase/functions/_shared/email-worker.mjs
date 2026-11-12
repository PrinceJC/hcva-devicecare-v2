// Shared, dependency-injected worker. Tests never call a real email provider.
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function equalSecret(a, b) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left),
    y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
export function createEmailHandler({
  env,
  createClient,
  fetchImpl = fetch,
  corsHeaders = {},
}) {
  return async function handler(request) {
    const origin = request.headers.get("origin");
    // DeviceCare-specific settings avoid collisions with other HCVA systems.
    const configuredOrigin = env("DEVICECARE_APP_ORIGIN") || env("APP_ORIGIN");
    let allowed;
    try {
      allowed = new URL(configuredOrigin).origin;
    } catch {
      allowed = null;
    }
    const local =
      (env("DEVICECARE_ALLOW_LOCALHOST") || env("ALLOW_LOCALHOST")) ===
        "true" && /^http:\/\/localhost:\d+$/.test(origin || "");
    const cors =
      origin && (origin === allowed || local)
        ? {
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
            "Access-Control-Allow-Headers":
              corsHeaders["Access-Control-Allow-Headers"] ||
              "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          }
        : {};
    const response = (status, value) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    if (origin && origin !== allowed && !local)
      return response(403, {
        error: "This application origin is not allowed.",
      });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return response(405, { error: "POST required" });
    const bearer =
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!bearer) return response(401, { error: "Authentication required" });
    const url = env("SUPABASE_URL");
    const publicKey =
      env("DEVICECARE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
    const secretKey =
      env("DEVICECARE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !publicKey || !secretKey)
      return response(503, { error: "Server credentials are not configured." });
    try {
      const cronSecret = env("DEVICECARE_CRON_SECRET") || env("CRON_SECRET");
      const isCron =
        Boolean(cronSecret) && (await equalSecret(bearer, cronSecret));
      if (!isCron) {
        const userClient = createClient(url, publicKey, {
          global: { headers: { Authorization: `Bearer ${bearer}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await userClient.auth.getUser(bearer);
        if (error || !data?.user)
          return response(401, { error: "Please sign in again." });
        const role = await userClient.rpc("devicecare_is_admin");
        if (role.error || role.data !== true)
          return response(403, { error: "Administrator access required" });
      }
      const raw = await request.text();
      if (raw.length > 1024)
        return response(400, { error: "Request too large" });
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return response(400, { error: "Invalid JSON" });
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        return response(400, { error: "Request must be a JSON object" });
      if (body.mode && body.mode !== "check")
        return response(400, { error: "Unknown email operation" });
      const onlyId = body.job_id || null;
      if (onlyId && (typeof onlyId !== "string" || !UUID.test(onlyId)))
        return response(400, { error: "Invalid email job ID" });
      const apiKey = env("DEVICECARE_RESEND_API_KEY") || env("RESEND_API_KEY");
      if (body.mode === "check") {
        const service = createClient(url, secretKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const settings = await service
          .from("action_email_settings")
          .select("email_enabled,reminders_enabled")
          .eq("id", true)
          .single();
        if (settings.error || !settings.data)
          return response(503, {
            error:
              "DeviceCare email settings are unavailable. Check the DeviceCare migrations and server credentials.",
          });
        return response(200, {
          reachable: true,
          provider_configured: Boolean(apiKey),
          email_enabled: settings.data.email_enabled,
          reminders_enabled: settings.data.reminders_enabled,
          scheduler_secret_configured: Boolean(cronSecret),
          note: "Connection checked. No email was queued or sent. Provider credentials and sender domain still require a controlled send test.",
        });
      }
      if (!apiKey)
        return response(503, {
          error: "Resend is not configured. Approved emails remain queued.",
        });
      const service = createClient(url, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const reminders = await service.rpc("enqueue_action_reminders");
      if (reminders.error)
        throw new Error(
          "Could not prepare reminders. Check the database migration.",
        );
      let claimed = 0,
        accepted = 0,
        retried = 0,
        failed = 0,
        unknown = 0;
      for (let i = 0; i < (onlyId ? 1 : 5); i++) {
        const claim = await service.rpc("claim_action_email", {
          p_only_id: onlyId,
        });
        if (claim.error) throw new Error("Could not claim an email job.");
        const job = claim.data?.[0];
        if (!job) break;
        claimed++;
        let providerId = null,
          errorMessage = null,
          retryable = false;
        try {
          const sent = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": `devicecare/${job.id}`,
            },
            body: JSON.stringify(job.payload),
            signal: AbortSignal.timeout(15000),
          });
          const data = await sent.json().catch(() => ({}));
          if (sent.ok && typeof data.id === "string") providerId = data.id;
          else {
            retryable =
              sent.status === 408 ||
              sent.status === 429 ||
              sent.status >= 500 ||
              sent.ok;
            errorMessage = `Email provider returned ${sent.status}: ${String(data.message || "No acceptance ID returned").slice(0, 300)}`;
          }
        } catch {
          retryable = true;
          errorMessage =
            "Email provider connection interrupted. A retry uses the same idempotency key.";
        }
        const finish = await service.rpc("finish_action_email", {
          p_id: job.id,
          p_lock_token: job.lock_token,
          p_provider_id: providerId,
          p_error: errorMessage,
          p_retryable: retryable,
        });
        if (finish.error)
          throw new Error(
            "Could not record email outcome. The lease will expire and the same job can be reconciled or retried safely within its retry window.",
          );
        if (finish.data === "accepted") accepted++;
        else if (finish.data === "queued") retried++;
        else if (finish.data === "unknown") unknown++;
        else failed++;
      }
      return response(200, {
        claimed,
        accepted,
        retry_scheduled: retried,
        rejected: failed,
        needs_review: unknown,
      });
    } catch (error) {
      return response(500, {
        error: error instanceof Error ? error.message : "Email worker failed.",
      });
    }
  };
}
