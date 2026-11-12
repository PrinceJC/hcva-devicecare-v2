import { supabase } from "./supabase.js";

export const INCIDENT_STATUSES = {
  open: "Open",
  in_progress: "In progress",
  waiting_va: "Waiting for VA",
  resolved: "Resolved",
  closed: "Closed",
};
export const INCIDENT_PRIORITIES = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};
export const INCIDENT_CATEGORIES = {
  hardware: "Hardware",
  software: "Software",
  network: "Network / internet",
  access: "Account / access",
  other: "Other",
};
export const ACTIVE_INCIDENT_STATUSES = ["open", "in_progress", "waiting_va"];
export const ticketLabel = (number) => `INC-${String(number).padStart(5, "0")}`;
export function incidentTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
export function manilaDateTimeInput() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
async function unwrap(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
async function unwrapIncident(request) {
  const data = await unwrap(request);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id)
    throw new Error(
      "The server returned no incident record. Retry the unchanged submission.",
    );
  return row;
}
async function allCurrent(table) {
  const rows = [];
  for (let page = 0; ; page++) {
    const data = await unwrap(
      supabase
        .from(table)
        .select("*")
        .eq("archived", false)
        .order("id")
        .range(page * 100, page * 100 + 99),
    );
    rows.push(...data);
    if (data.length < 100) return rows;
  }
}
export async function getIncidentOptions() {
  const [people, devices] = await Promise.all([
    allCurrent("va_people"),
    allCurrent("devices"),
  ]);
  people.sort((a, b) => a.full_name.localeCompare(b.full_name));
  devices.sort((a, b) => a.model.localeCompare(b.model));
  return { people, devices };
}
export async function listIncidents({
  status = "active",
  search = "",
  page = 0,
  size = 15,
} = {}) {
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 100
  )
    throw new Error("Invalid pagination.");
  let query = supabase.from("device_incidents").select("*", { count: "exact" });
  if (status === "active") query = query.in("status", ACTIVE_INCIDENT_STATUSES);
  else if (status !== "all") query = query.eq("status", status);
  const term = search.trim();
  if (/^(?:INC-)?\d+$/i.test(term))
    query = query.eq("ticket_number", Number(term.replace(/^INC-/i, "")));
  else if (term)
    query = query.ilike("search_text", `%${term.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, count, error } = await query
    .order("reported_at", { ascending: false })
    .order("id")
    .range(page * size, page * size + size - 1);
  if (error) throw error;
  return { records: data, count: count || 0 };
}
export const getIncident = (id) =>
  unwrap(supabase.from("device_incidents").select("*").eq("id", id).single());
export async function getIncidentEvents(id) {
  const events = [];
  for (let page = 0; ; page++) {
    const rows = await unwrap(
      supabase
        .from("incident_events")
        .select("*")
        .eq("incident_id", id)
        .order("created_at")
        .order("id")
        .range(page * 100, page * 100 + 99),
    );
    events.push(...rows);
    if (rows.length < 100) return events;
  }
}
export const createIncident = ({
  request_id,
  person_id,
  device_id,
  device_label,
  title,
  description,
  category,
  priority,
  reported_at,
}) =>
  unwrapIncident(
    supabase.rpc("create_device_incident", {
      p_request_id: request_id,
      p_person_id: person_id,
      p_device_id: device_id || null,
      p_device_label: device_label || "",
      p_title: title,
      p_description: description,
      p_category: category,
      p_priority: priority,
      p_reported_at: reported_at,
    }),
  );
export const updateIncident = ({
  request_id,
  incident_id,
  expected_version,
  status,
  priority,
  note,
  resolution,
}) =>
  unwrapIncident(
    supabase.rpc("record_incident_update", {
      p_request_id: request_id,
      p_incident_id: incident_id,
      p_expected_version: expected_version,
      p_status: status,
      p_priority: priority,
      p_note: note || "",
      p_resolution: resolution || "",
    }),
  );
export async function getIncidentOverview() {
  const responses = await Promise.all([
    supabase
      .from("device_incidents")
      .select("id", { count: "exact", head: true })
      .in("status", ACTIVE_INCIDENT_STATUSES),
    supabase
      .from("device_incidents")
      .select("id", { count: "exact", head: true })
      .in("status", ACTIVE_INCIDENT_STATUSES)
      .in("priority", ["high", "urgent"]),
    supabase
      .from("device_incidents")
      .select("id", { count: "exact", head: true })
      .in("status", ["resolved", "closed"]),
    supabase
      .from("device_incidents")
      .select(
        "id,ticket_number,title,person_name_snapshot,device_model_snapshot,status,priority,reported_at",
      )
      .in("status", ACTIVE_INCIDENT_STATUSES)
      .order("reported_at", { ascending: false })
      .order("id")
      .limit(5),
  ]);
  for (const response of responses) if (response.error) throw response.error;
  return {
    active: responses[0].count || 0,
    high: responses[1].count || 0,
    resolved: responses[2].count || 0,
    recent: responses[3].data || [],
  };
}
