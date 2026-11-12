import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  listPlans: vi.fn(),
  planDetails: vi.fn(),
  savePlan: vi.fn(),
  previewEmail: vi.fn(),
  approvePlan: vi.fn(),
  changePlanStatus: vi.fn(),
  processEmails: vi.fn(),
  emailSettings: vi.fn(),
  saveEmailSettings: vi.fn(),
}));
vi.mock("../../src/lib/actions.js", async (original) => ({
  ...(await original()),
  ...mocks,
}));
import ActionPlans from "../../src/components/ActionPlans.jsx";
import EmailSettings from "../../src/components/EmailSettings.jsx";
let plan;
const payload = {
  from: "HCVA IT <it@example.com>",
  to: ["va@example.com"],
  cc: ["ceo@example.com", "coo@example.com", "hr@example.com"],
  reply_to: "it@example.com",
  subject: "Action required: Backup power",
  text: "Arrange backup power by December 31, 2026.",
};
beforeEach(() => {
  vi.clearAllMocks();
  plan = {
    id: "p1",
    version: 2,
    revision: 0,
    status: "draft",
    title: "Backup power",
    person_name: "Sample VA",
    device_name: "Sample laptop",
    failed_checks: "Battery and power",
    findings: "Unreliable backup.",
    required_actions: "Arrange backup power.",
    recipient_email: "va@example.com",
    due_date: "2026-12-31",
  };
  mocks.listPlans.mockImplementation(async () => ({
    records: [plan],
    count: 1,
  }));
  mocks.planDetails.mockImplementation(async () => ({
    plan: { ...plan },
    events: [],
    emails: plan.revision
      ? [
          {
            id: "j1",
            revision: 1,
            kind: "initial",
            payload,
            status: "queued",
            attempts: 0,
            created_at: "2026-11-12T01:00:00Z",
          },
        ]
      : [],
    checks: [
      {
        id: "passing1",
        inspected_on: "2026-11-12",
        created_at: "2026-11-12T01:00:00Z",
      },
    ],
  }));
  mocks.savePlan.mockImplementation(
    async (p, form) => (plan = { ...plan, ...form, version: p.version + 1 }),
  );
  mocks.previewEmail.mockResolvedValue({
    plan_version: 2,
    settings_version: 1,
    payload,
  });
  mocks.approvePlan.mockImplementation(
    async () =>
      (plan = { ...plan, status: "awaiting_action", version: 3, revision: 1 }),
  );
  mocks.processEmails.mockResolvedValue({
    accepted: 1,
    claimed: 1,
    retry_scheduled: 0,
    rejected: 0,
    needs_review: 0,
  });
  mocks.changePlanStatus.mockResolvedValue({ ...plan, status: "completed" });
  mocks.emailSettings.mockResolvedValue({
    version: 1,
    email_enabled: false,
    reminders_enabled: false,
    sender_email: "it@example.com",
    reply_to_email: "it@example.com",
    ceo_email: "ceo@example.com",
    coo_email: "coo@example.com",
    hr_email: "hr@example.com",
  });
  mocks.saveEmailSettings.mockImplementation(async (value) => ({
    ...value,
    version: 2,
  }));
});
afterEach(cleanup);
async function open() {
  render(<ActionPlans />);
  fireEvent.click(await screen.findByRole("button", { name: "Review plan" }));
  await screen.findByLabelText("Required actions");
}
describe("reviewed action emails", () => {
  it("never sends simply because a draft is opened; approval requires preview and recipient confirmation", async () => {
    await open();
    expect(mocks.processEmails).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Approve and queue email" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview email and recipients" }),
    );
    await screen.findByText("Review the exact email");
    expect(
      screen.getByText("ceo@example.com, coo@example.com, hr@example.com"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve and queue email" }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and queue email" }),
    );
    await waitFor(() =>
      expect(mocks.approvePlan).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ plan_version: 2, settings_version: 1 }),
      ),
    );
    await waitFor(() => expect(mocks.processEmails).toHaveBeenCalledWith("j1"));
  });
  it("requires changed draft fields to be saved before preview", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Required actions"), {
      target: { value: "Upgrade RAM and arrange backup power." },
    });
    expect(
      screen.getByRole("button", { name: "Preview email and recipients" })
        .disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByLabelText("Required actions").closest("form"));
    await waitFor(() => expect(mocks.savePlan).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Preview email and recipients" })
          .disabled,
      ).toBe(false),
    );
  });
  it("retains approval if immediate email processing fails so staff can use the queue", async () => {
    mocks.processEmails.mockRejectedValue(
      new Error("Worker is not configured"),
    );
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview email and recipients" }),
    );
    await screen.findByText("Review the exact email");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and queue email" }),
    );
    await screen.findByText(
      /Plan approved and queued. Email processing could not finish/,
    );
    expect(mocks.approvePlan).toHaveBeenCalledTimes(1);
  });
  it("captures the reviewed leadership settings without sending on save", async () => {
    render(<EmailSettings />);
    await screen.findByLabelText("CEO email (CC)");
    fireEvent.click(screen.getByLabelText("Enable email sending"));
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Save email settings" })
        .closest("form"),
    );
    await waitFor(() =>
      expect(mocks.saveEmailSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          email_enabled: true,
          ceo_email: "ceo@example.com",
        }),
      ),
    );
    expect(mocks.processEmails).not.toHaveBeenCalled();
  });
});
