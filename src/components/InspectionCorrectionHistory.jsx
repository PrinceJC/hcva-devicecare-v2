import { useEffect, useState } from "react";
import { inspectionCorrections } from "../lib/inspectionCorrections.js";
import { screenshotUrl } from "../lib/inspectionEvidence.js";
function changes(row) {
  const before = row.before_inspection,
    after = row.after_inspection,
    b = row.before_details || {},
    a = row.after_details;
  const rows = [];
  const add = (label, old, value) => {
    if ((old || "") !== (value || ""))
      rows.push([label, old || "Not recorded", value || "Not recorded"]);
  };
  for (const [code, check] of Object.entries(after.results)) {
    const names = { pass: "Pass", fail: "Fail", na: "Not applicable" };
    add(check.title, names[before.results[code]?.result], names[check.result]);
    add(`${check.title} — notes`, b.check_notes?.[code], a.check_notes?.[code]);
  }
  for (const [key, label] of [
    ["internet_provider", "Internet provider"],
    ["backup_internet", "Backup internet"],
    ["backup_power", "Backup power"],
    ["summary", "Findings summary"],
  ])
    add(label, b[key] ?? (key === "summary" ? before.findings : ""), a[key]);
  return rows;
}
export default function InspectionCorrectionHistory({ reportId, version }) {
  const [rows, setRows] = useState([]),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [image, setImage] = useState("");
  useEffect(() => {
    setPage(0);
  }, [reportId, version]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setImage("");
    inspectionCorrections(reportId, page)
      .then((data) => {
        if (active) setRows(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [reportId, version, page]);
  async function show(path) {
    setError("");
    try {
      setImage(await screenshotUrl(path));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <section style={{ marginTop: 24 }}>
      <h3>Correction history</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p role="status">Loading corrections…</p>
      ) : (
        <>
          {!rows.length && <p className="muted">No corrections recorded.</p>}
          {rows.map((row) => (
            <details key={row.id} style={{ marginBottom: 16 }}>
              <summary>
                Revision {row.after_inspection.correction_version} ·{" "}
                {new Date(row.created_at).toLocaleString("en-PH", {
                  timeZone: "Asia/Manila",
                })}{" "}
                · {row.actor_email}
              </summary>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>
                <strong>Reason:</strong> {row.reason}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes(row).map(([label, before, after]) => (
                      <tr key={label}>
                        <td>{label}</td>
                        <td style={{ whiteSpace: "pre-wrap" }}>{before}</td>
                        <td style={{ whiteSpace: "pre-wrap" }}>{after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {row.before_details?.speed_screenshot_path !==
                row.after_details.speed_screenshot_path && (
                <p>Speed screenshot changed. Original evidence is retained.</p>
              )}
              {row.before_details?.speed_screenshot_path && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => show(row.before_details.speed_screenshot_path)}
                >
                  View original screenshot
                </button>
              )}
              {row.after_details.speed_screenshot_path && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => show(row.after_details.speed_screenshot_path)}
                >
                  View revised screenshot
                </button>
              )}
            </details>
          ))}
          <div className="pagination">
            <button
              type="button"
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous corrections
            </button>
            <span>Page {page + 1}</span>
            <button
              type="button"
              className="secondary"
              disabled={rows.length < 20}
              onClick={() => setPage((p) => p + 1)}
            >
              More corrections
            </button>
          </div>
        </>
      )}
      {image && (
        <div>
          <a href={image} target="_blank" rel="noopener noreferrer">
            Open screenshot (link valid for five minutes)
          </a>
          <img
            src={image}
            alt="Retained inspection screenshot from correction history"
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: 420,
              objectFit: "contain",
            }}
          />
        </div>
      )}
    </section>
  );
}
