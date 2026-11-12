import { useEffect, useState } from "react";
import {
  ACTION_STATUSES,
  EMAIL_STATUSES,
  EMAIL_KINDS,
  listPlans,
  planDetails,
  savePlan,
  previewEmail,
  approvePlan,
  changePlanStatus,
  processEmails,
  manilaToday,
  timestamp,
  emailResultMessage,
} from "../lib/actions.js";

function Detail({ id, onClose, onChanged }) {
  const [details, setDetails] = useState(null),
    [form, setForm] = useState(null),
    [preview, setPreview] = useState(null),
    [reviewed, setReviewed] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [refresh, setRefresh] = useState(0),
    [nextStatus, setNextStatus] = useState(""),
    [note, setNote] = useState(""),
    [recheck, setRecheck] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    planDetails(id)
      .then((d) => {
        if (!active) return;
        setDetails(d);
        setForm({
          title: d.plan.title,
          required_actions: d.plan.required_actions,
          recipient_email: d.plan.recipient_email,
          due_date: d.plan.due_date || "",
        });
        setPreview(null);
        setReviewed(false);
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
  }, [id, refresh]);
  function reload() {
    setRefresh((v) => v + 1);
    onChanged();
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await savePlan(details.plan, form);
      setMessage("Draft saved. Preview the email before approving.");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function previewDraft() {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewEmail(id));
      setReviewed(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    if (!reviewed) return;
    setBusy(true);
    setError("");
    setMessage("");
    let approved;
    try {
      approved = await approvePlan(id, preview);
    } catch (e) {
      setError(e.message);
      setBusy(false);
      return;
    }
    setPreview(null);
    setReviewed(false);
    setMessage("Plan approved and email queued.");
    try {
      const current = await planDetails(id);
      const initial = current.emails.find(
        (j) => j.kind === "initial" && j.revision === approved.revision,
      );
      if (initial) {
        const r = await processEmails(initial.id);
        setMessage(emailResultMessage(r));
      }
    } catch (e) {
      setMessage(
        `Plan approved and queued. Email processing could not finish: ${e.message}. The scheduled worker can retry queued jobs once it is configured.`,
      );
    } finally {
      setBusy(false);
      reload();
    }
  }
  async function sendQueued(jobId) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(emailResultMessage(await processEmails(jobId)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      reload();
    }
  }
  async function change(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await changePlanStatus(details.plan, nextStatus, note, recheck);
      setMessage("Action status updated.");
      setNote("");
      setNextStatus("");
      setRecheck("");
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const plan = details?.plan;
  const dirty =
    form &&
    plan &&
    (form.title !== plan.title ||
      form.required_actions !== plan.required_actions ||
      form.recipient_email !== plan.recipient_email ||
      form.due_date !== (plan.due_date || ""));
  const transitions =
    plan?.status === "draft"
      ? ["cancelled"]
      : plan?.status === "awaiting_action"
        ? ["submitted_for_recheck", "completed", "draft", "cancelled"]
        : plan?.status === "submitted_for_recheck"
          ? ["awaiting_action", "completed", "draft", "cancelled"]
          : [];
  return (
    <section className="panel action-detail">
      <div className="action-detail-heading">
        <h3>Email and action plan for {details?.plan.person_name || "VA"}</h3>
        <button className="secondary" disabled={busy} onClick={onClose}>
          Close details
        </button>
      </div>
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
        disabled={busy || loading}
        onClick={() => setRefresh((v) => v + 1)}
      >
        Reload latest details
      </button>
      {loading ? (
        <p role="status">Loading action plan…</p>
      ) : (
        plan && (
          <>
            <div className="action-meta">
              <div>
                <small>VA / candidate</small>
                <strong>{plan.person_name}</strong>
              </div>
              <div>
                <small>Device</small>
                <strong>{plan.device_name}</strong>
              </div>
              <div>
                <small>Status</small>
                <strong>{ACTION_STATUSES[plan.status]}</strong>
              </div>
              <div>
                <small>Deadline · Manila</small>
                <strong>{plan.due_date || "Not set"}</strong>
              </div>
            </div>
            <h3>Failed checks</h3>
            <p className="preserve-lines">{plan.failed_checks}</p>
            <h3>IT findings</h3>
            <p className="preserve-lines">{plan.findings}</p>
            {plan.status === "draft" ? (
              <form onSubmit={save}>
                <fieldset disabled={busy}>
                  <label htmlFor="action-title">Email / plan title</label>
                  <input
                    id="action-title"
                    value={form.title}
                    maxLength={180}
                    required
                    onChange={(e) => {
                      setForm({ ...form, title: e.target.value });
                      setPreview(null);
                    }}
                  />
                  <label htmlFor="action-recipient">VA email</label>
                  <input
                    id="action-recipient"
                    type="email"
                    value={form.recipient_email}
                    required
                    onChange={(e) => {
                      setForm({ ...form, recipient_email: e.target.value });
                      setPreview(null);
                    }}
                  />
                  <label htmlFor="action-deadline">
                    Deadline (end of day, Manila)
                  </label>
                  <input
                    id="action-deadline"
                    type="date"
                    min={manilaToday()}
                    value={form.due_date}
                    required
                    onChange={(e) => {
                      setForm({ ...form, due_date: e.target.value });
                      setPreview(null);
                    }}
                  />
                  <label htmlFor="action-required">Required actions</label>
                  <textarea
                    id="action-required"
                    rows={5}
                    value={form.required_actions}
                    maxLength={10000}
                    required
                    placeholder="State the specific changes required, such as upgrading RAM or arranging backup power, and how IT will verify them."
                    onChange={(e) => {
                      setForm({ ...form, required_actions: e.target.value });
                      setPreview(null);
                    }}
                  />
                  <button type="submit">Save draft</button>
                </fieldset>
              </form>
            ) : (
              <>
                <h3>Approved required actions</h3>
                <p className="preserve-lines">{plan.required_actions}</p>
                <p className="muted">
                  Recipient: {plan.recipient_email} · Revision {plan.revision}
                </p>
              </>
            )}
            {plan.status === "draft" && (
              <div className="action-preview-section">
                <button
                  disabled={busy || Boolean(dirty)}
                  onClick={previewDraft}
                >
                  Preview email and recipients
                </button>
                {dirty && (
                  <p className="muted">Save your changes before previewing.</p>
                )}
                {preview && (
                  <div className="action-email-preview">
                    <h3>Review the exact email</h3>
                    <p>
                      <strong>From:</strong> {preview.payload.from}
                    </p>
                    <p>
                      <strong>To:</strong> {preview.payload.to.join(", ")}
                    </p>
                    <p>
                      <strong>CC:</strong> {preview.payload.cc.join(", ")}
                    </p>
                    <p>
                      <strong>Reply to:</strong> {preview.payload.reply_to}
                    </p>
                    <p>
                      <strong>Subject:</strong> {preview.payload.subject}
                    </p>
                    <pre>{preview.payload.text}</pre>
                    <label className="action-checkbox">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(e) => setReviewed(e.target.checked)}
                      />{" "}
                      I reviewed the required actions, deadline, VA address, and
                      leadership CC recipients.
                    </label>
                    <button disabled={busy || !reviewed} onClick={approve}>
                      {busy ? "Sending…" : "Approve and send to this VA"}
                    </button>
                  </div>
                )}
              </div>
            )}
            {transitions.length > 0 && (
              <form className="action-transition" onSubmit={change}>
                <h3>Record progress / arrange recheck</h3>
                <fieldset disabled={busy}>
                  <label htmlFor="action-status">New status</label>
                  <select
                    id="action-status"
                    required
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                  >
                    <option value="">Choose status</option>
                    {transitions.map((s) => (
                      <option key={s} value={s}>
                        {s === "draft"
                          ? "Return to draft for changes"
                          : ACTION_STATUSES[s]}
                      </option>
                    ))}
                  </select>
                  {nextStatus === "completed" && (
                    <>
                      <label htmlFor="action-recheck">
                        Passing recheck inspection
                      </label>
                      <select
                        id="action-recheck"
                        required
                        value={recheck}
                        onChange={(e) => setRecheck(e.target.value)}
                      >
                        <option value="">
                          Select a later passing inspection
                        </option>
                        {details.checks.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.inspected_on} · recorded{" "}
                            {timestamp(i.created_at)}
                          </option>
                        ))}
                      </select>
                      <p className="muted">
                        Complete a passing maintenance inspection on the same
                        device before closing this plan.
                      </p>
                    </>
                  )}
                  <label htmlFor="action-note">IT progress note</label>
                  <textarea
                    id="action-note"
                    required
                    rows={3}
                    maxLength={10000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Record the VA's update, recheck findings, or reason for changing the plan."
                  />
                  <button type="submit">Save status update</button>
                </fieldset>
              </form>
            )}
            <h3 className="action-section-title">Email history</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Message</th>
                    <th>Status</th>
                    <th>Recipients</th>
                    <th>Last detail</th>
                    <th>Send</th>
                  </tr>
                </thead>
                <tbody>
                  {details.emails.map((j) => (
                    <tr key={j.id}>
                      <td>
                        {EMAIL_KINDS[j.kind]}
                        <small>
                          Revision {j.revision} · {timestamp(j.created_at)}
                        </small>
                      </td>
                      <td>
                        {EMAIL_STATUSES[j.status]}
                        <small>Attempts: {j.attempts}</small>
                      </td>
                      <td>
                        {j.payload.to.join(", ")}
                        <small>CC: {j.payload.cc.join(", ")}</small>
                      </td>
                      <td>
                        {j.last_error ||
                          (j.accepted_at
                            ? timestamp(j.accepted_at)
                            : "Awaiting processing")}
                        <small>{j.provider_id || ""}</small>
                      </td>
                      <td>
                        {j.status === "queued" &&
                          plan.status === "awaiting_action" && (
                            <button
                              disabled={busy}
                              onClick={() => sendQueued(j.id)}
                            >
                              Send this VA email
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!details.emails.length && (
                <p className="muted">No email has been queued.</p>
              )}
            </div>
            <p className="muted">
              “Accepted” means the provider accepted the message. It does not
              prove delivery or action completion. Unknown outcomes require
              checking Resend before arranging another notification.
            </p>
            <h3 className="action-section-title">Action history</h3>
            <ol className="action-timeline">
              {details.events.map((e) => (
                <li key={e.id}>
                  <strong>{e.event_type.replaceAll("_", " ")}</strong>
                  <small>{timestamp(e.created_at)} · Manila</small>
                  <p className="preserve-lines">{e.note}</p>
                </li>
              ))}
            </ol>
          </>
        )
      )}
    </section>
  );
}
export default function ActionPlans({ initialPlanId = null, onNavigate }) {
  const [status, setStatus] = useState("all"),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState(initialPlanId),
    [result, setResult] = useState({ records: [], count: 0 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listPlans({ status, page, search: query })
      .then((r) => {
        if (active) setResult(r);
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
  }, [status, page, refresh, query]);
  return (
    <section className="directory">
      <h2>VA evaluation emails and action plans</h2>
      <p className="muted">
        Failed inspections create drafts automatically. Review requirements and
        deadlines before sending any email.
      </p>
      {onNavigate && (
        <button
          className="secondary"
          onClick={() => onNavigate("emailsettings")}
        >
          Email settings and connection check
        </button>
      )}
      {selected && (
        <Detail
          key={selected}
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={() => setRefresh((v) => v + 1)}
        />
      )}
      <div className="panel">
        <form
          className="action-list-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQuery(search);
          }}
        >
          <div>
            <label htmlFor="va-email-search">Find a VA by name</label>
            <input
              id="va-email-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit">Find VA</button>
        </form>
        <div className="action-list-toolbar">
          <div>
            <label htmlFor="action-filter">Status</label>
            <select
              id="action-filter"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All plans</option>
              {Object.entries(ACTION_STATUSES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => setRefresh((v) => v + 1)}
          >
            Refresh plans
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p role="status">Loading plans…</p>
        ) : (
          !error && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>VA / device</th>
                      <th>Required action</th>
                      <th>Deadline</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.person_name}</strong>
                          <small>{p.device_name}</small>
                        </td>
                        <td>{p.title}</td>
                        <td>
                          {p.due_date || "Set during review"}
                          {p.status === "awaiting_action" &&
                            p.due_date < manilaToday() && (
                              <small className="error">Overdue</small>
                            )}
                        </td>
                        <td>{ACTION_STATUSES[p.status]}</td>
                        <td>
                          <button
                            className="secondary"
                            onClick={() => setSelected(p.id)}
                          >
                            {p.status === "draft"
                              ? "Review and email VA"
                              : "Open VA email / history"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.records.length && (
                  <p className="empty-state">
                    No matching plans. Complete an inspection with a failed item
                    to create a draft.
                  </p>
                )}
              </div>
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={page === 0}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Previous
                </button>
                <span>
                  {result.count} plans · Page {page + 1}
                </span>
                <button
                  className="secondary"
                  disabled={(page + 1) * 15 >= result.count}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )
        )}
      </div>
    </section>
  );
}
