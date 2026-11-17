import { useEffect, useState } from "react";
import {
  getInspectionDetails,
  screenshotUrl,
} from "../lib/inspectionEvidence.js";
export default function InspectionEvidence({ report }) {
  const [details, setDetails] = useState(null),
    [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetails(null);
    setImage("");
    setError("");
    (async () => {
      try {
        const d = await getInspectionDetails(report.id);
        if (!active) return;
        setDetails(d);
        if (d?.speed_screenshot_path) {
          const url = await screenshotUrl(d.speed_screenshot_path);
          if (active) setImage(url);
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [report.id, refresh]);
  return (
    <section>
      {loading && <p role="status">Loading notes and internet details…</p>}
      {error && (
        <p className="error" role="alert">
          Could not load inspection evidence: {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Checklist item</th>
              <th>Result</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.results).map(([code, check]) => (
              <tr key={code}>
                <td>
                  <strong>{check.title}</strong>
                  <small>{check.description}</small>
                </td>
                <td className={check.result === "fail" ? "error" : ""}>
                  {{ pass: "Pass", fail: "Fail", na: "Not applicable" }[
                    check.result
                  ] || check.result}
                </td>
                <td style={{ whiteSpace: "pre-wrap" }}>
                  {details?.check_notes?.[code] || "No item note recorded."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ marginTop: 24 }}>Internet and backup setup at inspection</h3>
      {details ? (
        <>
          <p>
            <strong>Main internet provider:</strong>{" "}
            {details.internet_provider || "Not recorded"}
          </p>
          <p>
            <strong>Backup internet:</strong>{" "}
            {details.backup_internet || "Not recorded"}
          </p>
          <p>
            <strong>Backup power:</strong>{" "}
            {details.backup_power || "Not recorded"}
          </p>
          {details.speed_screenshot_path ? (
            <>
              {image && (
                <a href={image} target="_blank" rel="noopener noreferrer">
                  <img
                    src={image}
                    alt="Internet speed test screenshot recorded for this inspection"
                    style={{
                      display: "block",
                      maxWidth: "100%",
                      maxHeight: 420,
                      objectFit: "contain",
                      borderRadius: 8,
                    }}
                    onError={() =>
                      setError(
                        "The image link expired or could not load. Refresh the evidence link.",
                      )
                    }
                  />
                </a>
              )}
              <p className="muted">
                The private screenshot link expires after five minutes.
              </p>
            </>
          ) : (
            <p className="muted">No internet speed screenshot attached.</p>
          )}
        </>
      ) : (
        !loading &&
        !error && (
          <p className="muted">
            This inspection has no additional evidence. Older reports remain
            available without these new fields.
          </p>
        )
      )}
      <button
        type="button"
        className="secondary"
        disabled={loading}
        onClick={() => setRefresh((v) => v + 1)}
      >
        Refresh evidence link
      </button>
    </section>
  );
}
