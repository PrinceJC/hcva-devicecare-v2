import { useEffect, useState } from "react";
import {
  emailSettings,
  saveEmailSettings,
  processEmails,
} from "../lib/actions.js";
export default function EmailSettings() {
  const [form, setForm] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    emailSettings()
      .then((v) => {
        if (active) setForm(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setForm(await saveEmailSettings(form));
      setMessage(
        "Email settings saved. Existing approved emails keep their reviewed recipients.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function process() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await processEmails();
      setMessage(
        `Processed ${r.claimed} jobs. Provider accepted ${r.accepted}; retries scheduled ${r.retry_scheduled}; rejected ${r.rejected}; needs review ${r.needs_review}. Open the plan's email history for details.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="directory">
      <h2>Email settings</h2>
      <p className="muted">
        Configure the verified sender and leadership recipients for action
        plans.
      </p>
      {error && (
        <p className="error message" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="action-success" role="status">
          {message}
        </p>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => setReload((v) => v + 1)}
      >
        Reload settings
      </button>
      {form ? (
        <form className="panel action-settings" onSubmit={save}>
          <fieldset disabled={busy}>
            <div className="action-form-grid">
              {[
                ["sender_email", "Verified sender email"],
                ["reply_to_email", "IT reply-to email"],
                ["ceo_email", "CEO email (CC)"],
                ["coo_email", "COO email (CC)"],
                ["hr_email", "HR email (CC)"],
              ].map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={name}>{label}</label>
                  <input
                    id={name}
                    type="email"
                    value={form[name]}
                    required={form.email_enabled}
                    onChange={(e) =>
                      setForm({ ...form, [name]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <label className="action-checkbox">
              <input
                type="checkbox"
                checked={form.email_enabled}
                onChange={(e) =>
                  setForm({ ...form, email_enabled: e.target.checked })
                }
              />{" "}
              Enable email sending
            </label>
            <label className="action-checkbox">
              <input
                type="checkbox"
                checked={form.reminders_enabled}
                onChange={(e) =>
                  setForm({ ...form, reminders_enabled: e.target.checked })
                }
              />{" "}
              Enable automatic deadline reminders and overdue escalation
            </label>
            <p className="muted">
              Reminders are sent at most once for each stage: within 3 days
              before the deadline, on the due date, and after it becomes
              overdue. They stop while awaiting IT recheck or after completion.
            </p>
            <button type="submit">
              {busy ? "Saving…" : "Save email settings"}
            </button>
          </fieldset>
        </form>
      ) : (
        <p>Loading settings…</p>
      )}
      <div className="panel action-settings">
        <h3>Email processing</h3>
        <p className="muted">
          Approved emails are queued immediately. The scheduled worker processes
          jobs hourly when configured. You can process ready jobs now.
        </p>
        <button disabled={busy || !form?.email_enabled} onClick={process}>
          Process queued emails now
        </button>
        <p className="muted">
          A provider acceptance is not proof of inbox delivery. Jobs marked
          “Needs manual reconciliation” must be checked in Resend before
          arranging a new notification.
        </p>
      </div>
    </section>
  );
}
