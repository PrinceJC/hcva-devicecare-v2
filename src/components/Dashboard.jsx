import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import Icon from "./Icon.jsx";
import IncidentOverview from "./IncidentOverview.jsx";
import ActionOverview from "./ActionOverview.jsx";

function todayManila() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function dateLabel(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^\s*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function Dashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [exporting, setExporting] = useState(false);
  const today = todayManila();
  const half = Number(today.slice(5, 7)) <= 6 ? 1 : 2;
  const start = `${today.slice(0, 4)}-${half === 1 ? "01" : "07"}-01`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    async function load() {
      const responses = await Promise.all([
        supabase
          .from("va_people")
          .select("id", { count: "exact", head: true })
          .eq("archived", false),
        supabase
          .from("devices")
          .select("id", { count: "exact", head: true })
          .eq("archived", false),
        supabase
          .from("device_schedule")
          .select("id", { count: "exact", head: true })
          .in("schedule_status", ["due_soon", "overdue"]),
        supabase
          .from("device_schedule")
          .select("id", { count: "exact", head: true })
          .eq("needs_attention", true),
        supabase
          .from("inspections")
          .select("id", { count: "exact", head: true })
          .gte("inspected_on", start)
          .lte("inspected_on", today),
        supabase
          .from("device_schedule")
          .select("*")
          .order("next_due_date")
          .order("id")
          .limit(6),
      ]);
      for (const response of responses)
        if (response.error) throw response.error;
      if (!cancelled)
        setData({
          people: responses[0].count || 0,
          devices: responses[1].count || 0,
          due: responses[2].count || 0,
          attention: responses[3].count || 0,
          inspections: responses[4].count || 0,
          upcoming: responses[5].data || [],
        });
    }
    load()
      .catch((error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today, start, refresh]);

  async function exportReport() {
    setExporting(true);
    setError("");
    try {
      const records = [];
      for (let page = 0; ; page++) {
        const { data: rows, error } = await supabase
          .from("device_schedule")
          .select("*")
          .order("next_due_date")
          .order("id")
          .range(page * 100, page * 100 + 99);
        if (error) throw error;
        records.push(...rows);
        if (rows.length < 100) break;
      }
      const rows = [
        [
          "VA / candidate",
          "Stage",
          "Device",
          "Asset tag",
          "Last inspection",
          "Next inspection",
          "Schedule status",
          "Needs attention",
        ],
        ...records.map((d) => [
          d.full_name,
          d.stage,
          d.model,
          d.asset_tag,
          d.last_inspected_on,
          d.next_due_date,
          d.schedule_status,
          d.needs_attention ? "Yes" : "No",
        ]),
      ];
      const url = URL.createObjectURL(
        new Blob(
          ["\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")],
          { type: "text/csv;charset=utf-8" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `hcva-maintenance-${today}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error.message);
    } finally {
      setExporting(false);
    }
  }

  const cards = [
    [
      "Total VAs & candidates",
      data?.people,
      "Team members registered",
      "people",
      "",
    ],
    [
      "Registered devices",
      data?.devices,
      "Active device records",
      "devices",
      "",
    ],
    [
      "Due / overdue",
      data?.due,
      "Due within 30 days or earlier",
      "schedule",
      "orange",
    ],
    [
      "Needs attention",
      data?.attention,
      "Scheduled devices with unresolved issues",
      "shield",
      "red",
    ],
  ];

  return (
    <section className="dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR MAINTENANCE WORKSPACE</span>
          <h1>A healthier device. A smoother workday.</h1>
          <p className="muted">
            Your team's preventive maintenance, all in one place.
          </p>
        </div>
        <div className="heading-actions">
          <button
            className="secondary"
            onClick={exportReport}
            disabled={exporting}
          >
            <Icon name="download" />
            {exporting ? "Exporting…" : "Export report"}
          </button>
          <button onClick={() => onNavigate("people")}>
            <Icon name="plus" /> Add VA / candidate
          </button>
        </div>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}{" "}
          <button
            className="secondary compact"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Retry loading
          </button>
        </div>
      )}
      <div className="welcome-banner">
        <span className="banner-symbol">
          <Icon name="shield" />
        </span>
        <div>
          <strong>Your next check starts here</strong>
          <p>
            {loading
              ? "Loading your maintenance overview…"
              : !data
                ? "The overview is unavailable. Retry loading above."
                : data.devices
                  ? `${data.due} scheduled ${data.due === 1 ? "device is" : "devices are"} due within 30 days or overdue. Plan your next checks.`
                  : "Add your team, register their devices, and build a consistent maintenance routine."}
          </p>
        </div>
        <button className="secondary" onClick={() => onNavigate("schedule")}>
          View schedule <Icon name="arrow" />
        </button>
      </div>
      <div className="stats-grid">
        {cards.map(([label, value, note, name, color]) => (
          <div className="stat-card" key={label}>
            <div className="stat-label">
              {label}
              <Icon name={name} />
            </div>
            <strong className="stat-value">
              {loading ? "…" : (value ?? "—")}
            </strong>
            <span className={`stat-note ${color}`}>{note}</span>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <div className="panel overview-panel">
          <div className="panel-heading">
            <div>
              <h2>Maintenance overview</h2>
              <p className="muted">Your nearest scheduled device checks</p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("devices")}
            >
              View inventory <Icon name="arrow" />
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>VA / candidate</th>
                  <th>Device</th>
                  <th>Next check</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4" className="empty-state">
                      Loading devices…
                    </td>
                  </tr>
                ) : data?.upcoming.length ? (
                  data.upcoming.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <div className="person-cell">
                          <span className="avatar">
                            {device.full_name
                              .split(" ")
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((s) => s[0])
                              .join("")}
                          </span>
                          <div>
                            <strong>{device.full_name}</strong>
                            <small>
                              {
                                {
                                  candidate: "Candidate",
                                  active: "Active VA",
                                  inactive: "Inactive",
                                }[device.stage]
                              }
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>{device.model}</strong>
                        <small>
                          {device.asset_tag ||
                            device.operating_system ||
                            "No asset tag"}
                        </small>
                      </td>
                      <td>
                        {dateLabel(device.next_due_date)}
                        <small>
                          {device.days_until_due < 0
                            ? `${Math.abs(device.days_until_due)} days overdue`
                            : device.days_until_due === 0
                              ? "Due today"
                              : `In ${device.days_until_due} days`}
                        </small>
                      </td>
                      <td>
                        <span
                          className={`status-badge ${device.schedule_status}`}
                        >
                          {
                            {
                              overdue: "Overdue",
                              due_soon: "Due soon",
                              on_track: "On track",
                            }[device.schedule_status]
                          }
                        </span>
                        {device.needs_attention && (
                          <small className="error">Needs attention</small>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="4" className="empty-state">
                      <Icon name="devices" />
                      <p>
                        {data
                          ? "No scheduled devices yet."
                          : "Overview unavailable."}
                      </p>
                      {data && (
                        <button
                          className="secondary"
                          onClick={() => onNavigate("devices")}
                        >
                          Register a device
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="table-foot">
            <span>Showing up to 6 upcoming checks</span>
            <button
              className="text-button"
              onClick={() => setRefresh((v) => v + 1)}
              disabled={loading}
            >
              Refresh overview
            </button>
          </div>
        </div>
        <div className="dashboard-side">
          <div className="cycle-card">
            <span className="eyebrow">A CONSISTENT MAINTENANCE RHYTHM</span>
            <div className="cycle-row">
              <div className="cadence-ring">
                <div>
                  <strong>6</strong>
                  <span>months</span>
                </div>
              </div>
              <div>
                <strong>
                  Plan. Inspect.
                  <br />
                  Follow through.
                </strong>
                <p>
                  One repeatable routine
                  <br />
                  for every work device.
                </p>
              </div>
            </div>
            <div className="cycle-summary">
              <span>
                Inspections recorded · H{half} {today.slice(0, 4)}
              </span>
              <strong>{loading ? "…" : (data?.inspections ?? "—")}</strong>
            </div>
            <p className="muted cycle-caption">
              Historical inspection records this calendar half-year, including
              repeat checks.
            </p>
          </div>
          <div className="panel rhythm-card">
            <div className="panel-heading">
              <h2>Keep your team ready</h2>
            </div>
            {[
              ["people", "1. Register your team", "Add each VA or candidate."],
              [
                "devices",
                "2. Connect their devices",
                "Record assets and first check dates.",
              ],
              [
                "check",
                "3. Inspect every six months",
                "Complete checks and track issues.",
              ],
            ].map(([icon, title, copy]) => (
              <div className="rhythm-step" key={title}>
                <span>
                  <Icon name={icon} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <IncidentOverview onNavigate={onNavigate} />
      <ActionOverview onNavigate={onNavigate} />
    </section>
  );
}
