import { useEffect, useRef, useState } from "react";
import { getChecklist } from "../lib/maintenance.js";
import {
  completeDetailedInspection,
  uploadInspectionScreenshot,
  validateScreenshot,
} from "../lib/inspectionEvidence.js";

function manilaToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export default function InspectionForm({ device, onSaved, onCancel }) {
  const [checks, setChecks] = useState([]);
  const [results, setResults] = useState({});
  const [checkNotes, setCheckNotes] = useState({});
  const [internet, setInternet] = useState({
    internet_provider: device.internet_provider || "",
    backup_internet: device.backup_internet || "",
    backup_power: device.backup_power || "",
  });
  const [screenshot, setScreenshot] = useState(null);
  const [date, setDate] = useState(manilaToday);
  const [findings, setFindings] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // Retain the same request ID when retrying an unchanged submission.
  const pendingRequest = useRef(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");

    getChecklist()
      .then((records) => {
        if (cancelled) return;

        if (!records.length) {
          throw new Error("No maintenance checklist was found.");
        }

        setChecks(records);
        setResults(
          Object.fromEntries(records.map((check) => [check.code, ""])),
        );
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [retry]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (checks.some((check) => !results[check.code])) {
      setError("Choose a result for every checklist item.");
      return;
    }

    if (checks.every((check) => results[check.code] === "na")) {
      setError("At least one checklist item must be applicable.");
      return;
    }

    const failed = checks.some((check) => results[check.code] === "fail");

    if (
      checks.some(
        (check) =>
          results[check.code] === "fail" && !checkNotes[check.code]?.trim(),
      )
    ) {
      setError("Add a note for each failed check.");
      return;
    }

    const payload = {
      device_id: device.id,
      inspected_on: date,
      results,
      findings: findings.trim(),
      check_notes: Object.fromEntries(
        Object.entries(checkNotes)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value),
      ),
      ...Object.fromEntries(
        Object.entries(internet).map(([key, value]) => [key, value.trim()]),
      ),
    };

    const fingerprint = JSON.stringify(payload);

    if (
      pendingRequest.current?.fingerprint !== fingerprint ||
      pendingRequest.current?.file !== screenshot
    ) {
      pendingRequest.current = {
        fingerprint,
        file: screenshot,
        uploadedPath: null,
        id: crypto.randomUUID(),
      };
    }

    setBusy(true);

    try {
      validateScreenshot(screenshot);
      if (screenshot && !pendingRequest.current.uploadedPath) {
        pendingRequest.current.uploadedPath = await uploadInspectionScreenshot(
          screenshot,
          pendingRequest.current.id,
        );
      }
      await completeDetailedInspection({
        ...payload,
        request_id: pendingRequest.current.id,
        speed_screenshot_path: pendingRequest.current.uploadedPath,
      });
    } catch (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    onSaved({ hasFailures: failed, inspectionId: pendingRequest.current.id });
  }

  return (
    <div className="panel inspection-panel">
      <h3>Maintenance inspection: {device.model}</h3>
      <p className="muted">
        Record the actual results of your device checks. Failed checks require
        follow-up notes.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status">Loading checklist…</p>
      ) : checks.length === 0 ? (
        <button
          type="button"
          className="secondary"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry loading checklist
        </button>
      ) : (
        <form onSubmit={handleSubmit}>
          <fieldset disabled={busy}>
            <label htmlFor="inspection_date">Inspection date</label>
            <input
              id="inspection_date"
              type="date"
              value={date}
              min={device.last_inspected_on || undefined}
              max={manilaToday()}
              onChange={(event) => setDate(event.target.value)}
              required
            />

            {checks.map((check) => (
              <div className="check-item" key={check.code}>
                <label htmlFor={`check_${check.code}`}>{check.title}</label>

                <p className="muted">{check.description}</p>

                <select
                  id={`check_${check.code}`}
                  value={results[check.code] || ""}
                  onChange={(event) => {
                    const value = event.target.value;

                    setResults((current) => ({
                      ...current,
                      [check.code]: value,
                    }));
                  }}
                  required
                >
                  <option value="">Select result</option>
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="na">Not applicable</option>
                </select>
                <label htmlFor={`note_${check.code}`}>
                  Notes — {check.title}
                  {results[check.code] === "fail"
                    ? " (required)"
                    : " (optional)"}
                </label>
                <textarea
                  id={`note_${check.code}`}
                  rows={2}
                  maxLength={4000}
                  value={checkNotes[check.code] || ""}
                  required={results[check.code] === "fail"}
                  onChange={(event) =>
                    setCheckNotes((current) => ({
                      ...current,
                      [check.code]: event.target.value,
                    }))
                  }
                  placeholder="Record observations, measurements, or the reason for this result."
                />
              </div>
            ))}

            <h3 style={{ marginTop: 24 }}>Internet and backup setup</h3>
            <p className="muted">
              These values are saved with this inspection and become the
              device's current setup. Enter “None” when no backup is available.
            </p>
            {[
              ["internet_provider", "Main internet provider", 300],
              ["backup_internet", "Backup internet", 500],
              ["backup_power", "Backup power", 500],
            ].map(([name, label, limit]) => (
              <div key={name}>
                <label htmlFor={`inspection_${name}`}>{label}</label>
                <input
                  id={`inspection_${name}`}
                  value={internet[name]}
                  maxLength={limit}
                  onChange={(event) =>
                    setInternet((current) => ({
                      ...current,
                      [name]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
            <label htmlFor="speed_screenshot">
              Internet speed screenshot (optional)
            </label>
            <input
              id="speed_screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                try {
                  validateScreenshot(file);
                  setScreenshot(file);
                  setError("");
                } catch (e) {
                  setError(e.message);
                  event.target.value = "";
                  setScreenshot(null);
                }
              }}
            />
            <p className="muted">
              PNG, JPG or WebP, up to 5 MB. Capture download/upload speed and
              ping. Crop out passwords, patient information and unrelated
              windows. Attachments are visible to DeviceCare admins.
            </p>
            {screenshot && <p role="status">Selected: {screenshot.name}</p>}
            <label htmlFor="inspection_findings">
              Findings and follow-up actions
            </label>
            <textarea
              id="inspection_findings"
              rows={4}
              maxLength={10000}
              value={findings}
              onChange={(event) => setFindings(event.target.value)}
              placeholder="Describe any issues and required actions."
            />

            <button type="submit">
              {busy ? "Saving inspection…" : "Complete inspection"}
            </button>
          </fieldset>
        </form>
      )}

      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onCancel}
      >
        Cancel inspection
      </button>
    </div>
  );
}
