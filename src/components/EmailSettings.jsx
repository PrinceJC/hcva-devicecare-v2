import { useEffect, useState } from "react";
import {
  emailSettings,
  saveEmailSettings,
  checkEmailConnection,
} from "../lib/actions.js";

export default function EmailSettings({ onNavigate }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [connection, setConnection] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    emailSettings()
      .then((v) => {
        if (active) setForm(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
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
      setConnection(null);
      setMessage(
        "Email settings saved. No email was sent. Previously approved messages keep their reviewed recipients.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setError("");
    setMessage("");
    setConnection(null);
    try {
      setConnection(await checkEmailConnection());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="directory">
      <h2>DeviceCare email settings</h2>
      <p className="muted">
        Send an individual VA a reviewed action plan after a failed evaluation.
        Sender settings belong to DeviceCare; ATS keeps its own settings.
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
      <div className="panel action-settings">
        <h3>1. Connection check</h3>
        <p>
          Check that this website can reach the DeviceCare email function and
          read its configuration. This check sends no email and does not process
          queued messages.
        </p>
        <p className="muted">
          Website origin: <code>{window.location.origin}</code>
        </p>
        <button disabled={busy} onClick={check}>
          {busy ? "Please wait…" : "Check email connection"}
        </button>
        {connection && (
          <div role="status" className="action-connection-result">
            <p>
              <strong>DeviceCare function reachable.</strong> No email was sent.
            </p>
            <ul>
              <li>
                Provider API key:{" "}
                {connection.provider_configured
                  ? "Configured (not yet validated by a send)"
                  : "Missing — add DEVICECARE_RESEND_API_KEY in Supabase function secrets"}
              </li>
              <li>
                Saved email sending:{" "}
                {connection.email_enabled
                  ? "Enabled"
                  : "Disabled — enable and save below when ready"}
              </li>
              <li>
                Reminder worker secret:{" "}
                {connection.scheduler_secret_configured
                  ? "Configured — hourly schedule must also be installed"
                  : "Not configured — manual sending is still available"}
              </li>
            </ul>
            <p className="muted">
              A successful check does not verify the sender domain, provider
              account, or inbox delivery. Use a controlled individual send after
              setup.
            </p>
          </div>
        )}
        <details className="email-help">
          <summary>Fix “Failed to send a request to the Edge Function”</summary>
          <ol>
            <li>
              Deploy <code>process-action-emails</code> from the DeviceCare
              project folder. Database push does not deploy functions.
            </li>
            <li>
              In Supabase function secrets, set{" "}
              <code>DEVICECARE_APP_ORIGIN</code> to the website origin shown
              above, and set the DeviceCare provider and server keys.
            </li>
            <li>
              Run the connection check again. Follow{" "}
              <code>EMAIL-UPDATE.md</code> included with this update.
            </li>
          </ol>
          <p>
            Keep ATS secrets and its function in place. Never paste a server
            secret key into Vercel variables with a VITE_ prefix.
          </p>
        </details>
      </div>
      <button
        className="secondary"
        disabled={busy || loading}
        onClick={() => setReload((v) => v + 1)}
      >
        Reload settings
      </button>
      {loading ? (
        <p role="status">Loading settings…</p>
      ) : (
        form && (
          <form className="panel action-settings" onSubmit={save}>
            <h3>2. Sender and leadership CC</h3>
            <p className="muted">
              The VA recipient is set on each evaluation's action plan. Only the
              sender and leadership defaults are configured here. Use a sender
              address on a domain verified in Resend.
            </p>
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
                      value={form[name] || ""}
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
                    setForm({
                      ...form,
                      email_enabled: e.target.checked,
                      reminders_enabled:
                        e.target.checked && form.reminders_enabled,
                    })
                  }
                />{" "}
                Enable email sending
              </label>
              <label className="action-checkbox">
                <input
                  type="checkbox"
                  checked={form.reminders_enabled}
                  disabled={!form.email_enabled}
                  onChange={(e) =>
                    setForm({ ...form, reminders_enabled: e.target.checked })
                  }
                />{" "}
                Enable automatic deadline reminders and overdue escalation
              </label>
              <p className="muted">
                Reminders require the hourly schedule in Supabase. They stop
                while awaiting IT recheck or after completion. Saving settings
                never sends an email.
              </p>
              <button type="submit">
                {busy ? "Saving…" : "Save email settings"}
              </button>
            </fieldset>
          </form>
        )
      )}
      <div className="panel action-settings">
        <h3>3. Send to one VA</h3>
        <ol>
          <li>Complete the VA's device evaluation.</li>
          <li>
            If any check fails, click “Review and email this VA”, or find their
            name in Action plans.
          </li>
          <li>
            Save the required improvements, VA address, and deadline; preview
            the exact email and leadership CC.
          </li>
          <li>
            Confirm the recipients and click “Approve and send to this VA”.
          </li>
        </ol>
        {onNavigate && (
          <button onClick={() => onNavigate("actions")}>
            Open VA evaluation emails
          </button>
        )}
        <p className="muted">
          For an already approved queued message, use “Send this VA email” in
          that plan's email history. It reuses the same job. Provider acceptance
          does not prove inbox delivery.
        </p>
      </div>
    </section>
  );
}
