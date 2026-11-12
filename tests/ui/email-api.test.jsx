import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/lib/supabase.js", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
import { processEmails, checkEmailConnection } from "../../src/lib/actions.js";
beforeEach(() => vi.resetAllMocks());
describe("email API boundaries", () => {
  it("requires a single queued job ID for UI sending", async () => {
    expect(() => processEmails()).toThrow(/individual VA/);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue({ data: { accepted: 1 }, error: null });
    await processEmails("chosen-job");
    expect(mocks.invoke).toHaveBeenCalledWith("process-action-emails", {
      body: { job_id: "chosen-job" },
    });
  });
  it("uses a non-sending operation for connection checks", async () => {
    mocks.invoke.mockResolvedValue({ data: { reachable: true }, error: null });
    await checkEmailConnection();
    expect(mocks.invoke).toHaveBeenCalledWith("process-action-emails", {
      body: { mode: "check" },
    });
  });
  it("explains a missing deployment without retrying or creating another email", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });
    await expect(processEmails("existing-job")).rejects.toThrow(
      /Deploy process-action-emails/,
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("preserves a useful provider error returned by the server", async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status",
        context: new Response(
          JSON.stringify({
            error: "Resend is not configured. Approved emails remain queued.",
          }),
          { status: 503 },
        ),
      },
    });
    await expect(processEmails("existing-job")).rejects.toThrow(
      /Resend is not configured/,
    );
  });
});
