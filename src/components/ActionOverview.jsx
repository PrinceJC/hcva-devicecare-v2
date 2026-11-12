import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { manilaToday } from "../lib/actions.js";
export default function ActionOverview({ onNavigate }) {
  const [counts, setCounts] = useState(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([
      supabase
        .from("device_action_plans")
        .select("id", { count: "exact", head: true })
        .eq("status", "draft"),
      supabase
        .from("device_action_plans")
        .select("id", { count: "exact", head: true })
        .eq("status", "awaiting_action")
        .lt("due_date", manilaToday()),
      supabase
        .from("device_action_plans")
        .select("id", { count: "exact", head: true })
        .eq("status", "submitted_for_recheck"),
    ])
      .then((results) => {
        for (const r of results) if (r.error) throw r.error;
        if (active) setCounts(results.map((r) => r.count || 0));
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  return (
    <section className="panel action-overview">
      <div className="panel-heading">
        <div>
          <h2>Failed-assessment follow-up</h2>
          <p className="muted">Review action plans, deadlines, and rechecks.</p>
        </div>
        <button onClick={() => onNavigate("actions")}>Open action plans</button>
      </div>
      {error ? (
        <div className="action-overview-body">
          <p className="error" role="alert">
            {error}
          </p>
          <button
            className="secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="action-metrics">
          {["Drafts for IT review", "Overdue actions", "Ready for recheck"].map(
            (label, i) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{counts ? counts[i] : "…"}</strong>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
