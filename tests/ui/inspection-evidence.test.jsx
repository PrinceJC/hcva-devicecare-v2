import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  getChecklist: vi.fn(),
  completeDetailedInspection: vi.fn(),
  uploadInspectionScreenshot: vi.fn(),
  validateScreenshot: vi.fn(),
  getInspectionDetails: vi.fn(),
  screenshotUrl: vi.fn(),
}));
vi.mock("../../src/lib/maintenance.js", () => ({
  getChecklist: mocks.getChecklist,
}));
vi.mock("../../src/lib/inspectionEvidence.js", () => mocks);
import InspectionForm from "../../src/components/InspectionForm.jsx";
import InspectionEvidence from "../../src/components/InspectionEvidence.jsx";
const device = {
  id: "device-1",
  model: "Test laptop",
  internet_provider: "PLDT",
  backup_internet: "Smart",
  backup_power: "UPS",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChecklist.mockResolvedValue([
    { code: "hardware", title: "Hardware", description: "Check casing" },
  ]);
  mocks.completeDetailedInspection.mockResolvedValue({});
  mocks.uploadInspectionScreenshot.mockResolvedValue("private/path.png");
});
afterEach(cleanup);
describe("inspection notes and screenshots", () => {
  it("saves per-check notes and connectivity on a failed check with no duplicate upload on retry", async () => {
    const onSaved = vi.fn();
    render(
      <InspectionForm device={device} onSaved={onSaved} onCancel={() => {}} />,
    );
    fireEvent.change(await screen.findByLabelText("Hardware"), {
      target: { value: "fail" },
    });
    fireEvent.change(screen.getByLabelText("Notes — Hardware (required)"), {
      target: { value: "Cracked hinge" },
    });
    const screenshot = new File(["image"], "speed.png", { type: "image/png" });
    fireEvent.change(
      screen.getByLabelText("Internet speed screenshot (optional)"),
      { target: { files: [screenshot] } },
    );
    mocks.completeDetailedInspection.mockRejectedValueOnce(
      new Error("Connection lost"),
    );
    const form = screen
      .getByRole("button", { name: "Complete inspection" })
      .closest("form");
    fireEvent.submit(form);
    await screen.findByText("Connection lost");
    const first = mocks.completeDetailedInspection.mock.calls[0][0];
    expect(first).toEqual(
      expect.objectContaining({
        check_notes: { hardware: "Cracked hinge" },
        internet_provider: "PLDT",
        backup_internet: "Smart",
        backup_power: "UPS",
        speed_screenshot_path: "private/path.png",
      }),
    );
    fireEvent.submit(form);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mocks.uploadInspectionScreenshot).toHaveBeenCalledTimes(1);
    expect(mocks.completeDetailedInspection.mock.calls[1][0].request_id).toBe(
      first.request_id,
    );
  });
  it("blocks failed checks without a specific note", async () => {
    render(
      <InspectionForm device={device} onSaved={() => {}} onCancel={() => {}} />,
    );
    fireEvent.change(await screen.findByLabelText("Hardware"), {
      target: { value: "fail" },
    });
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Complete inspection" })
        .closest("form"),
    );
    await screen.findByText("Add a note for each failed check.");
    expect(mocks.completeDetailedInspection).not.toHaveBeenCalled();
  });
  it("renders historical notes and fetches a private screenshot link", async () => {
    mocks.getInspectionDetails.mockResolvedValue({
      check_notes: { hardware: "Checked hinge" },
      internet_provider: "Original ISP",
      backup_internet: "Data",
      backup_power: "UPS",
      speed_screenshot_path: "private/path.png",
    });
    mocks.screenshotUrl.mockResolvedValue(
      "https://example.com/private-signed-image",
    );
    render(
      <InspectionEvidence
        report={{
          id: "report-1",
          results: {
            hardware: {
              title: "Hardware",
              description: "Casing",
              result: "pass",
            },
          },
        }}
      />,
    );
    await screen.findByText("Checked hinge");
    expect(screen.getByText("Original ISP")).toBeTruthy();
    expect(
      await screen.findByAltText(
        "Internet speed test screenshot recorded for this inspection",
      ),
    ).toBeTruthy();
    expect(mocks.screenshotUrl).toHaveBeenCalledWith("private/path.png");
  });
  it("does not save an inspection when screenshot upload fails", async () => {
    mocks.uploadInspectionScreenshot.mockRejectedValue(
      new Error("Storage upload unavailable"),
    );
    render(
      <InspectionForm device={device} onSaved={() => {}} onCancel={() => {}} />,
    );
    fireEvent.change(await screen.findByLabelText("Hardware"), {
      target: { value: "pass" },
    });
    fireEvent.change(
      screen.getByLabelText("Internet speed screenshot (optional)"),
      {
        target: {
          files: [new File(["image"], "speed.png", { type: "image/png" })],
        },
      },
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Complete inspection" })
        .closest("form"),
    );
    await screen.findByText("Storage upload unavailable");
    expect(mocks.completeDetailedInspection).not.toHaveBeenCalled();
  });
  it("keeps the original checklist visible for older reports without extra evidence", async () => {
    mocks.getInspectionDetails.mockResolvedValue(null);
    render(
      <InspectionEvidence
        report={{
          id: "old-report",
          results: {
            hardware: {
              title: "Hardware",
              description: "Casing",
              result: "pass",
            },
          },
        }}
      />,
    );
    await screen.findByText(/Older reports remain available/);
    expect(screen.getByText("Pass")).toBeTruthy();
    expect(mocks.screenshotUrl).not.toHaveBeenCalled();
  });
});
