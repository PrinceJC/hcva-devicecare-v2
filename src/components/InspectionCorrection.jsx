import { useState, useRef } from "react";
import {
  loadInspectionForCorrection,
  correctInspection,
} from "../lib/inspectionCorrections.js";
import {
  uploadInspectionScreenshot,
  validateScreenshot,
} from "../lib/inspectionEvidence.js";
export default function InspectionCorrection({ reportId, onSaved }) {
  const [original, setOriginal] = useState(null),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [reason, setReason] = useState(""),
    [mode, setMode] = useState("keep"),
    [file, setFile] = useState(null);
  const pending = useRef(null),
    uploaded = useRef(null);
  async function open() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { inspection, details } =
        await loadInspectionForCorrection(reportId);
      setOriginal(inspection);
      setForm({
        results: Object.fromEntries(
          Object.entries(inspection.results).map(([code, c]) => [
            code,
            c.result,
          ]),
        ),
        notes: details?.check_notes || {},
        summary: details?.summary ?? inspection.findings,
        internet_provider: details?.internet_provider || "",
        backup_internet: details?.backup_internet || "",
        backup_power: details?.backup_power || "",
        screenshot_path: details?.speed_screenshot_path || null,
      });
      setReason("");
      setMode("keep");
      setFile(null);
      pending.current = null;
      uploaded.current = null;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    setError("");
    if (reason.trim().length < 5) {
      setError("Enter a correction reason of at least 5 characters.");
      return;
    }
    if (Object.values(form.results).every((v) => v === "na")) {
      setError("At least one check must be applicable.");
      return;
    }
    if (
      Object.entries(form.results).some(
        ([code, result]) => result === "fail" && !form.notes[code]?.trim(),
      )
    ) {
      setError("Add a note for each failed check.");
      return;
    }
    if (mode === "replace" && !file) {
      setError("Select a replacement screenshot.");
      return;
    }
    setBusy(true);
    try {
      let path = mode === "remove" ? null : form.screenshot_path;
      if (mode === "replace") {
        validateScreenshot(file);
        if (uploaded.current?.file !== file) {
          uploaded.current = {
            file,
            path: await uploadInspectionScreenshot(file, reportId),
          };
        }
        path = uploaded.current.path;
      }
      const payload = {
        ...form,
        inspection_id: reportId,
        version: original.correction_version || 1,
        reason: reason.trim(),
        screenshot_path: path,
      };
      const fingerprint = JSON.stringify(payload);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      const saved = await correctInspection({
        ...payload,
        request_id: pending.current.id,
      });
      setForm(null);
      setOriginal(null);
      setMessage(
        "Correction saved. Review any linked action plans before sending a new email.",
      );
      onSaved(saved.inspection);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 24 }}>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!form ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={open}
        >
          {busy ? "Loading inspection…" : "Edit inspection"}
        </button>
      ) : (
        <form className="panel" onSubmit={save}>
          <h3>
            Correct inspection · Revision {original.correction_version || 1}
          </h3>
          <p className="muted">
            Changes are recorded with your account, time and reason. Related
            action plans will require review. Sent emails keep their original
            content.
          </p>
          <p className="muted">
            Device, assigned VA, inspection date and maintenance schedule stay
            tied to the original evaluation. Internet edits here correct the
            historical report; use Device inventory to change the current setup.
          </p>
          <fieldset disabled={busy}>
            {Object.entries(original.results).map(([code, check]) => (
              <div className="check-item" key={code}>
                <label htmlFor={`correct_${code}`}>{check.title}</label>
                <select
                  id={`correct_${code}`}
                  value={form.results[code]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      results: { ...form.results, [code]: e.target.value },
                    })
                  }
                >
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="na">Not applicable</option>
                </select>
                <label htmlFor={`correct_note_${code}`}>
                  Notes — {check.title}
                </label>
                <textarea
                  id={`correct_note_${code}`}
                  rows={2}
                  maxLength={4000}
                  required={form.results[code] === "fail"}
                  value={form.notes[code] || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      notes: { ...form.notes, [code]: e.target.value },
                    })
                  }
                />
              </div>
            ))}
            {[
              ["internet_provider", "Main internet provider", 300],
              ["backup_internet", "Backup internet", 500],
              ["backup_power", "Backup power", 500],
            ].map(([name, label, max]) => (
              <div key={name}>
                <label htmlFor={`correct_${name}`}>{label}</label>
                <input
                  id={`correct_${name}`}
                  value={form[name]}
                  maxLength={max}
                  onChange={(e) => setForm({ ...form, [name]: e.target.value })}
                />
              </div>
            ))}
            <label htmlFor="correct_summary">
              Findings and follow-up actions
            </label>
            <textarea
              id="correct_summary"
              value={form.summary}
              rows={3}
              maxLength={10000}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
            />
            <label htmlFor="correct_screenshot_mode">Speed screenshot</label>
            <select
              id="correct_screenshot_mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="keep">Keep current screenshot</option>
              <option value="replace">Attach / replace screenshot</option>
              <option value="remove">
                Remove from current report (retain in history)
              </option>
            </select>
            {mode === "replace" && (
              <>
                <label htmlFor="correct_screenshot">
                  Replacement screenshot
                </label>
                <input
                  id="correct_screenshot"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    try {
                      validateScreenshot(f);
                      setFile(f);
                      setError("");
                    } catch (error) {
                      setError(error.message);
                      e.target.value = "";
                      setFile(null);
                    }
                  }}
                />
                <p className="muted">
                  PNG, JPG or WebP, up to 5 MB. Original screenshots remain in
                  correction history.
                </p>
              </>
            )}
            <label htmlFor="correction_reason">Reason for correction</label>
            <textarea
              id="correction_reason"
              rows={3}
              minLength={5}
              maxLength={2000}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what was recorded incorrectly and why you are changing it."
            />
            <button type="submit">
              {busy ? "Saving correction…" : "Save correction"}
            </button>
            <button type="button" className="secondary" onClick={open}>
              Reload latest inspection (discard edits)
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setForm(null);
                setError("");
              }}
            >
              Cancel editing
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
