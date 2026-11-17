import { supabase } from "./supabase.js";
export async function loadInspectionForCorrection(id) {
  const { data, error } = await supabase.rpc(
    "devicecare_inspection_for_correction",
    { p_id: id },
  );
  if (error) throw error;
  return data;
}
export async function correctInspection(p) {
  const { data, error } = await supabase.rpc("correct_device_inspection", {
    p_request_id: p.request_id,
    p_inspection_id: p.inspection_id,
    p_expected_version: p.version,
    p_reason: p.reason,
    p_results: p.results,
    p_check_notes: p.notes,
    p_summary: p.summary,
    p_internet_provider: p.internet_provider,
    p_backup_internet: p.backup_internet,
    p_backup_power: p.backup_power,
    p_speed_screenshot_path: p.screenshot_path,
  });
  if (error) throw error;
  return data;
}
export async function inspectionCorrections(id, page = 0) {
  const { data, error } = await supabase
    .from("devicecare_inspection_corrections")
    .select("*")
    .eq("inspection_id", id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(page * 20, page * 20 + 19);
  if (error) throw error;
  return data;
}
