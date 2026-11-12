import { useEffect, useState } from "react";
import {
  getIncidentOverview,
  INCIDENT_STATUSES,
  INCIDENT_PRIORITIES,
  ticketLabel,
} from "../lib/incidents.js";
import Icon from "./Icon.jsx";

export default function IncidentOverview({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getIncidentOverview()
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
  }, [refresh]);
  return (
    <section
      className="panel incident-overview"
      aria-labelledby="incident-overview-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="incident-overview-heading">
            Device incidents & IT assistance
          </h2>
          <p className="muted">
            Track reported problems alongside preventive maintenance.
          </p>
        </div>
        <button onClick={() => onNavigate("incidents")}>
          <Icon name="plus" /> Log / view incidents
        </button>
      </div>
      {error ? (
        <div className="incident-overview-body">
          <p className="error" role="alert">
            Could not load incidents: {error}
          </p>
          <button
            className="secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="incident-metrics">
            {[
              ["Active incidents", data?.active],
              ["High / urgent active", data?.high],
              ["Resolved / closed records", data?.resolved],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{loading ? "…" : (value ?? "—")}</strong>
              </div>
            ))}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>VA / candidate</th>
                  <th>Priority</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4">Loading incidents…</td>
                  </tr>
                ) : data?.recent.length ? (
                  data.recent.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{ticketLabel(row.ticket_number)}</strong> ·{" "}
                        {row.title}
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
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="empty-state">
                      No active incidents. Log a problem when a VA needs
                      assistance.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
