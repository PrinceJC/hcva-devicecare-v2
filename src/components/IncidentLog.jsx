import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import {
  getIncidentOptions,
  listIncidents,
  getIncident,
  getIncidentEvents,
  createIncident,
  updateIncident,
  INCIDENT_STATUSES,
  INCIDENT_PRIORITIES,
  INCIDENT_CATEGORIES,
  ticketLabel,
  incidentTime,
  manilaDateTimeInput,
} from "../lib/incidents.js";

const PAGE_SIZE = 15;
function requestId(ref, payload) {
  const fingerprint = JSON.stringify(payload);
  if (ref.current?.fingerprint !== fingerprint)
    ref.current = { fingerprint, id: crypto.randomUUID() };
  return ref.current.id;
}
function Options({ values }) {
  return Object.entries(values).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}

function NewIncident({ onCreated, onCancel }) {
  const [options, setOptions] = useState({ people: [], devices: [] });
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({
    person_id: "",
    device_id: "",
    device_label: "",
    title: "",
    description: "",
    category: "hardware",
    priority: "normal",
    reported_at: manilaDateTimeInput(),
  }));
  const request = useRef(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getIncidentOptions()
      .then((value) => {
        if (!cancelled) setOptions(value);
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
  }, [reload]);
  function change(event) {
    const { name, value } = event.target;
    setForm((previous) => ({
      ...previous,
      [name]: value,
      ...(name === "person_id" ? { device_id: "" } : {}),
    }));
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    const when = new Date(`${form.reported_at}+08:00`);
    if (Number.isNaN(when.getTime()))
      return setError("Enter a valid reported time in Manila time.");
    const payload = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      device_label: form.device_id ? "" : form.device_label.trim(),
      reported_at: when.toISOString(),
    };
    if (!payload.title || !payload.description)
      return setError("Enter the incident title and problem description.");
    setBusy(true);
    let saved;
    try {
      saved = await createIncident({
        ...payload,
        request_id: requestId(request, payload),
      });
    } catch (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    onCreated(saved);
  }
  const devices = options.devices.filter((d) => d.person_id === form.person_id);
  return (
    <section className="panel incident-create">
      <div className="incident-detail-heading">
        <div>
          <h3>Log a new incident</h3>
          <p className="muted">Record a VA's request for IT assistance.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading VAs and devices…</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={busy || options.people.length === 0}>
            <div className="incident-form-grid">
              <div>
                <label htmlFor="incident-person">VA / candidate</label>
                <select
                  required
                  id="incident-person"
                  name="person_id"
                  value={form.person_id}
                  onChange={change}
                >
                  <option value="">Select a team member</option>
                  {options.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="incident-device">
                  Registered device (optional)
                </label>
                <select
                  id="incident-device"
                  name="device_id"
                  value={form.device_id}
                  onChange={change}
                  disabled={!form.person_id}
                >
                  <option value="">No linked device / not registered</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.model}
                      {d.asset_tag ? ` · ${d.asset_tag}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {!form.device_id && (
                <div className="span-all">
                  <label htmlFor="incident-device-label">
                    Device details if not registered (optional)
                  </label>
                  <input
                    id="incident-device-label"
                    name="device_label"
                    value={form.device_label}
                    onChange={change}
                    maxLength={200}
                    placeholder="Example: VA's personal Dell laptop"
                  />
                </div>
              )}
              <div>
                <label htmlFor="incident-reported">
                  Reported at (Manila time)
                </label>
                <input
                  required
                  id="incident-reported"
                  type="datetime-local"
                  name="reported_at"
                  value={form.reported_at}
                  onChange={change}
                />
              </div>
              <div>
                <label htmlFor="incident-priority">Priority</label>
                <select
                  id="incident-priority"
                  name="priority"
                  value={form.priority}
                  onChange={change}
                >
                  <Options values={INCIDENT_PRIORITIES} />
                </select>
              </div>
              <div>
                <label htmlFor="incident-category">Category</label>
                <select
                  id="incident-category"
                  name="category"
                  value={form.category}
                  onChange={change}
                >
                  <Options values={INCIDENT_CATEGORIES} />
                </select>
              </div>
              <div>
                <label htmlFor="incident-title">Incident title</label>
                <input
                  required
                  id="incident-title"
                  name="title"
                  value={form.title}
                  onChange={change}
                  maxLength={180}
                  placeholder="Example: Laptop shuts down during calls"
                />
              </div>
              <div className="span-all">
                <label htmlFor="incident-description">
                  Problem description / impact
                </label>
                <textarea
                  required
                  id="incident-description"
                  name="description"
                  value={form.description}
                  onChange={change}
                  rows={4}
                  maxLength={10000}
                  placeholder="What happened, when it started, and how it affects work."
                />
              </div>
            </div>
            <div className="incident-form-actions">
              <button type="submit">
                {busy ? "Logging incident…" : "Log incident"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!loading && options.people.length === 0 && (
        <p className="muted">
          No team members are available. Add a current VA or candidate in the VA
          directory, then reload.
        </p>
      )}
      {!loading && error && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setReload((v) => v + 1)}
        >
          Reload VAs and devices
        </button>
      )}
    </section>
  );
}

function IncidentDetail({ id, onChanged, onClose }) {
  const [record, setRecord] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("normal");
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const request = useRef(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([getIncident(id), getIncidentEvents(id)])
      .then(([row, timeline]) => {
        if (cancelled) return;
        setRecord(row);
        setEvents(timeline);
        setStatus(row.status);
        setPriority(row.priority);
        setResolution(row.resolution);
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
  }, [id, reload]);
  const finalStatus = status === "resolved" || status === "closed";
  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (finalStatus && !resolution.trim())
      return setError(
        "Describe the resolution before resolving or closing this incident.",
      );
    const payload = {
      incident_id: id,
      expected_version: record.version,
      status,
      priority,
      note: note.trim(),
      resolution: finalStatus ? resolution.trim() : "",
    };
    setBusy(true);
    try {
      await updateIncident({
        ...payload,
        request_id: requestId(request, payload),
      });
    } catch (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setBusy(false);
    setNote("");
    setMessage("Incident update saved.");
    setReload((v) => v + 1);
    onChanged();
  }
  return (
    <section className="panel incident-detail">
      <div className="incident-detail-heading">
        <div>
          <span className="eyebrow">INCIDENT RECORD</span>
          <h3>
            {record
              ? `${ticketLabel(record.ticket_number)} · ${record.title}`
              : "Incident details"}
          </h3>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          Close details
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <button
        type="button"
        className="secondary compact"
        disabled={busy || loading}
        onClick={() => setReload((v) => v + 1)}
      >
        Reload latest details
      </button>
      {loading ? (
        <p role="status">Loading incident details…</p>
      ) : (
        record && (
          <>
            <div className="incident-record-meta">
              <div>
                <span>Reported by / affected VA</span>
                <strong>{record.person_name_snapshot}</strong>
              </div>
              <div>
                <span>Device</span>
                <strong>
                  {record.device_model_snapshot || "Device not linked"}
                </strong>
                <small>{record.asset_tag_snapshot}</small>
              </div>
              <div>
                <span>Reported at · Manila</span>
                <strong>{incidentTime(record.reported_at)}</strong>
              </div>
              <div>
                <span>Logged by</span>
                <strong>{record.created_by_email}</strong>
              </div>
              <div>
                <span>Category</span>
                <strong>{INCIDENT_CATEGORIES[record.category]}</strong>
              </div>
              <div>
                <span>Current state</span>
                <strong>
                  {INCIDENT_STATUSES[record.status]} ·{" "}
                  {INCIDENT_PRIORITIES[record.priority]}
                </strong>
              </div>
            </div>
            <h3>Problem description</h3>
            <p className="preserve-lines">{record.description}</p>
            {record.resolution && (
              <div className="incident-resolution">
                <strong>Recorded resolution</strong>
                <p className="preserve-lines">{record.resolution}</p>
                {record.resolved_at && (
                  <small>
                    Resolved: {incidentTime(record.resolved_at)} · Manila
                  </small>
                )}
              </div>
            )}
            <div className="incident-detail-grid">
              <form onSubmit={submit}>
                <h3>Add troubleshooting update</h3>
                <fieldset disabled={busy}>
                  <label htmlFor="update-status">Status</label>
                  <select
                    id="update-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <Options values={INCIDENT_STATUSES} />
                  </select>
                  <label htmlFor="update-priority">Priority</label>
                  <select
                    id="update-priority"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    <Options values={INCIDENT_PRIORITIES} />
                  </select>
                  <label htmlFor="update-note">Troubleshooting note</label>
                  <textarea
                    id="update-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={10000}
                    rows={4}
                    placeholder="Checks performed, findings, and next steps."
                  />
                  {finalStatus && (
                    <>
                      <label htmlFor="update-resolution">
                        Resolution / outcome
                      </label>
                      <textarea
                        required
                        id="update-resolution"
                        value={resolution}
                        onChange={(event) => setResolution(event.target.value)}
                        maxLength={10000}
                        rows={4}
                      />
                    </>
                  )}
                  <button type="submit">
                    {busy ? "Saving update…" : "Save incident update"}
                  </button>
                </fieldset>
              </form>
              <div>
                <h3>Activity history</h3>
                <ol className="incident-timeline">
                  {events.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.event_type === "created"
                          ? "Incident logged"
                          : `${INCIDENT_STATUSES[entry.from_status]} → ${INCIDENT_STATUSES[entry.to_status]}`}
                      </strong>
                      <small>
                        {incidentTime(entry.created_at)} · Manila
                        <br />
                        {entry.actor_email}
                      </small>
                      {entry.from_priority !== entry.to_priority &&
                        entry.from_priority && (
                          <p>
                            Priority: {INCIDENT_PRIORITIES[entry.from_priority]}{" "}
                            → {INCIDENT_PRIORITIES[entry.to_priority]}
                          </p>
                        )}
                      {entry.note && (
                        <p className="preserve-lines">{entry.note}</p>
                      )}
                      {entry.resolution && (
                        <p className="preserve-lines">
                          <strong>Resolution:</strong> {entry.resolution}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}

export default function IncidentLog() {
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState({ records: [], count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listIncidents({ status, search, page, size: PAGE_SIZE })
      .then((value) => {
        if (!cancelled) setData(value);
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
  }, [status, search, page, refresh]);
  function changed() {
    setRefresh((v) => v + 1);
  }
  function created(row) {
    setShowNew(false);
    setSelectedId(row.id);
    setStatus("active");
    setSearch("");
    setSearchInput("");
    setPage(0);
    setMessage(`${ticketLabel(row.ticket_number)} logged successfully.`);
    changed();
  }
  return (
    <section className="directory">
      <div className="page-heading">
        <div>
          <h2>Incident log</h2>
          <p className="muted">
            Device problems, IT assistance, and a clear record of what was done.
          </p>
        </div>
        <button
          disabled={showNew || Boolean(selectedId)}
          onClick={() => {
            setMessage("");
            setShowNew(true);
          }}
        >
          <Icon name="plus" /> Log incident
        </button>
      </div>
      {message && (
        <p className="incident-success" role="status">
          {message}
        </p>
      )}
      {showNew && (
        <NewIncident onCreated={created} onCancel={() => setShowNew(false)} />
      )}
      {selectedId && (
        <IncidentDetail
          key={selectedId}
          id={selectedId}
          onChanged={changed}
          onClose={() => setSelectedId(null)}
        />
      )}
      <div className="panel incident-register">
        <div className="incident-toolbar">
          <form
            className="incident-search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput);
              setPage(0);
            }}
          >
            <label htmlFor="incident-search">Search incident records</label>
            <div>
              <input
                id="incident-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Ticket number, VA, device, or problem"
              />
              <button type="submit" className="secondary">
                Search
              </button>
            </div>
          </form>
          <div>
            <label htmlFor="incident-filter">Status</label>
            <select
              id="incident-filter"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="active">Active incidents</option>
              <option value="all">All records</option>
              <Options values={INCIDENT_STATUSES} />
            </select>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={loading}
            onClick={changed}
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p role="status">Loading incidents…</p>
        ) : error ? (
          <p className="error" role="alert">
            Could not load incidents: {error}
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Incident / reported</th>
                    <th>VA / device</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>
                          {ticketLabel(row.ticket_number)} · {row.title}
                        </strong>
                        <small>{incidentTime(row.reported_at)} · Manila</small>
                      </td>
                      <td>
                        {row.person_name_snapshot}
                        <small>
                          {row.device_model_snapshot || "Device not linked"}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`incident-badge priority-${row.priority}`}
                        >
                          {INCIDENT_PRIORITIES[row.priority]}
                        </span>
                      </td>
                      <td>
                        <span className={`incident-badge status-${row.status}`}>
                          {INCIDENT_STATUSES[row.status]}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="secondary"
                            disabled={
                              showNew ||
                              (Boolean(selectedId) && selectedId !== row.id)
                            }
                            onClick={() => {
                              setMessage("");
                              setSelectedId(row.id);
                            }}
                          >
                            View record
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.records.length === 0 && (
                <p className="empty-state">
                  No incidents match this search and page. Use “All records” to
                  include resolved and closed incidents.
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
                {data.count} matching records · Page {page + 1}
              </span>
              <button
                className="secondary"
                disabled={(page + 1) * PAGE_SIZE >= data.count}
                onClick={() => setPage((v) => v + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
