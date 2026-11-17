import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  loadInspectionForCorrection: vi.fn(),
  correctInspection: vi.fn(),
  inspectionCorrections: vi.fn(),
  uploadInspectionScreenshot: vi.fn(),
  validateScreenshot: vi.fn(),
  screenshotUrl: vi.fn(),
}));
vi.mock("../../src/lib/inspectionCorrections.js", () => mocks);
vi.mock("../../src/lib/inspectionEvidence.js", () => mocks);
import InspectionCorrection from "../../src/components/InspectionCorrection.jsx";
import InspectionCorrectionHistory from "../../src/components/InspectionCorrectionHistory.jsx";
let report, details;
beforeEach(() => {
  vi.resetAllMocks();
  report = {
    id: "inspection-1",
    correction_version: 1,
    findings: "Original findings",
    results: {
      hardware: {
        title: "Hardware",
        description: "Check casing",
        result: "pass",
      },
    },
  };
  details = {
    check_notes: { hardware: "Original note" },
    summary: "Original findings",
    internet_provider: "Original ISP",
    backup_internet: "Mobile",
    backup_power: "UPS",
    speed_screenshot_path: "private/original.png",
  };
  mocks.loadInspectionForCorrection.mockResolvedValue({
    inspection: report,
    details,
  });
  mocks.correctInspection.mockResolvedValue({
    inspection: { ...report, correction_version: 2 },
  });
  mocks.uploadInspectionScreenshot.mockResolvedValue("private/replacement.png");
});
afterEach(cleanup);
async function open(onSaved = vi.fn()) {
  render(<InspectionCorrection reportId="inspection-1" onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit inspection" }));
  await screen.findByLabelText("Reason for correction");
  return onSaved;
}
describe("inspection correction interface", () => {
  it("requires a reason and does not mutate the report on open", async () => {
    await open();
    expect(mocks.correctInspection).not.toHaveBeenCalled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Save correction" }).closest("form"),
    );
    await screen.findByText(
      "Enter a correction reason of at least 5 characters.",
    );
    expect(mocks.correctInspection).not.toHaveBeenCalled();
  });
  it("keeps the current screenshot unless replacement or removal is chosen", async () => {
    const onSaved = await open();
    fireEvent.change(screen.getByLabelText("Main internet provider"), {
      target: { value: "Corrected ISP" },
    });
    fireEvent.change(screen.getByLabelText("Reason for correction"), {
      target: { value: "The recorded ISP was incorrect." },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save correction" }).closest("form"),
    );
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ correction_version: 2 }),
      ),
    );
    expect(mocks.correctInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        internet_provider: "Corrected ISP",
        screenshot_path: "private/original.png",
      }),
    );
    expect(mocks.uploadInspectionScreenshot).not.toHaveBeenCalled();
  });
  it("retains a replacement upload and the correction request ID for an unchanged retry", async () => {
    mocks.correctInspection.mockRejectedValueOnce(new Error("Connection lost"));
    await open();
    fireEvent.change(screen.getByLabelText("Speed screenshot"), {
      target: { value: "replace" },
    });
    fireEvent.change(screen.getByLabelText("Replacement screenshot"), {
      target: {
        files: [new File(["png"], "speed.png", { type: "image/png" })],
      },
    });
    fireEvent.change(screen.getByLabelText("Reason for correction"), {
      target: { value: "Replace the incorrect screenshot." },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save correction" }).closest("form"),
    );
    await screen.findByText("Connection lost");
    const id = mocks.correctInspection.mock.calls[0][0].request_id;
    fireEvent.submit(
      screen.getByRole("button", { name: "Save correction" }).closest("form"),
    );
    await screen.findByText(/Correction saved/);
    expect(mocks.uploadInspectionScreenshot).toHaveBeenCalledTimes(1);
    expect(mocks.correctInspection.mock.calls[1][0].request_id).toBe(id);
  });
  it("preserves edits when another editor saved a conflicting revision", async () => {
    mocks.correctInspection.mockRejectedValue(
      new Error(
        "This inspection was changed by someone else. Reload it before correcting",
      ),
    );
    await open();
    fireEvent.change(screen.getByLabelText("Notes — Hardware"), {
      target: { value: "My correction" },
    });
    fireEvent.change(screen.getByLabelText("Reason for correction"), {
      target: { value: "Fix recorded observations." },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save correction" }).closest("form"),
    );
    await screen.findByText(/changed by someone else/);
    expect(screen.getByLabelText("Notes — Hardware").value).toBe(
      "My correction",
    );
  });
  it("renders before and after values with the editor and correction reason", async () => {
    mocks.inspectionCorrections.mockResolvedValue([
      {
        id: "edit-1",
        actor_email: "it@example.com",
        reason: "Correcting provider name",
        created_at: "2026-11-18T01:00:00Z",
        before_inspection: report,
        after_inspection: { ...report, correction_version: 2 },
        before_details: details,
        after_details: { ...details, internet_provider: "Corrected ISP" },
      },
    ]);
    render(<InspectionCorrectionHistory reportId="inspection-1" version={2} />);
    await screen.findByText(/it@example.com/);
    expect(screen.getByText("Original ISP")).toBeTruthy();
    expect(screen.getByText("Corrected ISP")).toBeTruthy();
    expect(screen.getByText("Correcting provider name")).toBeTruthy();
  });
});
