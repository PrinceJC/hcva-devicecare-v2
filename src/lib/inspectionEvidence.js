import { supabase } from "./supabase.js";
const BUCKET = "devicecare-speed-evidence";
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export function validateScreenshot(file) {
  if (!file) return;
  if (!TYPES[file.type]) throw new Error("Use a PNG, JPG or WebP screenshot.");
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw new Error("The screenshot must be between 1 byte and 5 MB.");
}
export async function uploadInspectionScreenshot(file, inspectionId) {
  validateScreenshot(file);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user)
    throw new Error("Please sign in again before uploading.");
  const path = `${data.user.id}/${inspectionId}/${crypto.randomUUID()}.${TYPES[file.type]}`;
  const result = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "60",
    });
  if (result.error)
    throw new Error(
      `Screenshot upload failed: ${result.error.message}. Check that the new migration has been applied.`,
    );
  return path;
}
export async function completeDetailedInspection(p) {
  const { data, error } = await supabase.rpc("complete_device_inspection", {
    p_request_id: p.request_id,
    p_device_id: p.device_id,
    p_inspected_on: p.inspected_on,
    p_results: p.results,
    p_findings: p.findings,
    p_check_notes: p.check_notes,
    p_internet_provider: p.internet_provider,
    p_backup_internet: p.backup_internet,
    p_backup_power: p.backup_power,
    p_speed_screenshot_path: p.speed_screenshot_path || null,
  });
  if (error) throw error;
  return data;
}
export async function getInspectionDetails(inspectionId) {
  const { data, error } = await supabase
    .from("devicecare_inspection_details")
    .select("*")
    .eq("inspection_id", inspectionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
export async function screenshotUrl(path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
