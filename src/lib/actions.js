import { supabase } from "./supabase.js";
export const ACTION_STATUSES = {
  draft: "Draft — IT review",
  awaiting_action: "Awaiting action",
  submitted_for_recheck: "Submitted for recheck",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const EMAIL_STATUSES = {
  queued: "Queued",
  sending: "Sending",
  accepted: "Accepted by email provider",
  failed: "Rejected / failed",
  unknown: "Needs manual reconciliation",
  cancelled: "Cancelled",
};
export const EMAIL_KINDS = {
  initial: "Action required",
  before_due: "Deadline reminder",
  due_today: "Due today",
  overdue: "Overdue escalation",
};
export function manilaToday() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function timestamp(value) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
async function data(request) {
  const r = await request;
  if (r.error) throw r.error;
  return r.data;
}
async function row(request) {
  const d = await data(request);
  return Array.isArray(d) ? d[0] : d;
}
async function allRows(table, id) {
  const out = [];
  for (let page = 0; ; page++) {
    const rows = await data(
      supabase
        .from(table)
        .select("*")
        .eq("plan_id", id)
        .order("created_at")
        .order("id")
        .range(page * 100, page * 100 + 99),
    );
    out.push(...rows);
    if (rows.length < 100) return out;
  }
}
export const emailSettings = () =>
  row(
    supabase.from("action_email_settings").select("*").eq("id", true).single(),
  );
export const saveEmailSettings = (s) =>
  row(
    supabase.rpc("save_action_email_settings", {
      p_expected_version: s.version,
      p_email_enabled: s.email_enabled,
      p_reminders_enabled: s.reminders_enabled,
      p_sender_email: s.sender_email,
      p_reply_to_email: s.reply_to_email,
      p_ceo_email: s.ceo_email,
      p_coo_email: s.coo_email,
      p_hr_email: s.hr_email,
    }),
  );
export async function listPlans({ status = "all", page = 0 } = {}) {
  let q = supabase.from("device_action_plans").select("*", { count: "exact" });
  if (status !== "all") q = q.eq("status", status);
  const r = await q
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 15, page * 15 + 14);
  if (r.error) throw r.error;
  return { records: r.data, count: r.count || 0 };
}
export async function planDetails(id) {
  const [plan, events, emails] = await Promise.all([
    row(supabase.from("device_action_plans").select("*").eq("id", id).single()),
    allRows("action_plan_events", id),
    allRows("action_email_queue", id),
  ]);
  const checks = await data(
    supabase
      .from("inspections")
      .select("id,inspected_on,created_at")
      .eq("device_id", plan.device_id)
      .eq("has_failures", false)
      .gte("created_at", plan.created_at)
      .order("created_at", { ascending: false })
      .limit(50),
  );
  return { plan, events, emails, checks };
}
export const savePlan = (p, form) =>
  row(
    supabase.rpc("save_device_action_plan", {
      p_id: p.id,
      p_expected_version: p.version,
      p_title: form.title,
      p_required_actions: form.required_actions,
      p_recipient_email: form.recipient_email,
      p_due_date: form.due_date,
    }),
  );
export const previewEmail = (id) =>
  data(supabase.rpc("preview_device_action_email", { p_id: id }));
export const approvePlan = (id, preview) =>
  row(
    supabase.rpc("approve_device_action_plan", {
      p_id: id,
      p_expected_version: preview.plan_version,
      p_settings_version: preview.settings_version,
    }),
  );
export const changePlanStatus = (p, status, note, recheck) =>
  row(
    supabase.rpc("change_device_action_status", {
      p_id: p.id,
      p_expected_version: p.version,
      p_status: status,
      p_note: note,
      p_recheck_id: recheck || null,
    }),
  );
export async function processEmails(jobId) {
  const r = await supabase.functions.invoke("process-action-emails", {
    body: jobId ? { job_id: jobId } : {},
  });
  if (r.error) {
    let message = r.error.message;
    try {
      const body = await r.error.context.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }
  if (r.data?.error) throw new Error(r.data.error);
  return r.data;
}
