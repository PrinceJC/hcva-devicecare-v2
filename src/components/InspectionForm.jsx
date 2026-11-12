import { useEffect, useRef, useState } from "react";
import { getChecklist, completeInspection } from "../lib/maintenance.js";

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

    if (failed && !findings.trim()) {
      setError("Describe the failed checks and follow-up actions.");
      return;
    }

    const payload = {
      device_id: device.id,
      inspected_on: date,
      results,
      findings: findings.trim(),
    };

    const fingerprint = JSON.stringify(payload);

    if (pendingRequest.current?.fingerprint !== fingerprint) {
      pendingRequest.current = {
        fingerprint,
        id: crypto.randomUUID(),
      };
    }

    setBusy(true);

    try {
      await completeInspection({
        ...payload,
        request_id: pendingRequest.current.id,
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
              </div>
            ))}

            <label htmlFor="inspection_findings">
              Findings and follow-up actions
            </label>
            <textarea
              id="inspection_findings"
              rows={4}
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
