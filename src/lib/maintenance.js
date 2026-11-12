import { supabase } from './supabase.js';

async function unwrap(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export const signIn = (email, password) =>
  unwrap(supabase.auth.signInWithPassword({ email, password }));
export const signOut = () => unwrap(supabase.auth.signOut());
export const isAdmin = () => unwrap(supabase.rpc('devicecare_is_admin'));
export const getChecklist = () => unwrap(supabase.from('maintenance_checks')
  .select('*').order('sort_order'));

// Paginate lists so the UI does not silently stop at the API's row limit.
function pageRange(page, size) {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(size) || size < 1 || size > 100)
    throw new Error('Use page >= 0 and a page size between 1 and 100.');
  return [page * size, page * size + size - 1];
}
export const listPeople = (page = 0, size = 50) => unwrap(supabase.from('va_people')
  .select('*').eq('archived', false).order('full_name').order('id').range(...pageRange(page, size)));
export const createPerson = ({ full_name, email = '', stage = 'candidate', client_team = '', auth_user_id = null }) =>
  unwrap(supabase.from('va_people').insert({ full_name, email, stage, client_team, auth_user_id }).select().single());
export const updatePerson = (id, changes) => unwrap(supabase.from('va_people')
  .update(changes).eq('id', id).select().single());
export const archivePerson = id => updatePerson(id, { archived: true });

export const listDevices = (page = 0, size = 50) => unwrap(supabase.from('devices')
  .select('*').eq('archived', false).order('created_at').order('id').range(...pageRange(page, size)));
export const createDevice = ({ person_id, model, asset_tag = null, device_type = 'laptop',
  operating_system = '', specifications = '', notes = '', next_due_date }) => {
  if (!next_due_date) throw new Error('Choose the first inspection date.');
  return unwrap(supabase.from('devices').insert({ person_id, model,
    asset_tag: asset_tag?.trim() || null, device_type, operating_system,
    specifications, notes, next_due_date }).select().single());
};
export const updateDevice = (id, changes) => unwrap(supabase.from('devices')
  .update(changes).eq('id', id).select().single());
export const archiveDevice = id => updateDevice(id, { archived: true });

export function listSchedule({ status, attentionOnly = false, page = 0, size = 50 } = {}) {
  let request = supabase.from('device_schedule').select('*');
  if (status) request = request.eq('schedule_status', status);
  if (attentionOnly) request = request.eq('needs_attention', true);
  return unwrap(request.order('next_due_date').order('id').range(...pageRange(page, size)));
}

// Generate request_id ONCE when the form is submitted. Retain it on retries.
// Persist the pending submission in your UI if you need retries across reloads.
export function completeInspection({ request_id, device_id, inspected_on, results, findings = '' }) {
  if (!request_id) throw new Error('Generate and retain a request UUID for this inspection.');
  return unwrap(supabase.rpc('complete_inspection', {
    p_request_id: request_id, p_device_id: device_id,
    p_inspected_on: inspected_on, p_results: results, p_findings: findings,
  }));
}
export const listInspections = (device_id, page = 0, size = 50) => unwrap(supabase.from('inspections')
  .select('*').eq('device_id', device_id).order('inspected_on', { ascending: false })
  .order('created_at', { ascending: false }).order('id').range(...pageRange(page, size)));
export const resolveIssue = (device_id, resolution) => unwrap(supabase.rpc('resolve_device_issue', {
  p_device_id: device_id, p_resolution: resolution,
}));
export const listResolutions = (device_id, page = 0, size = 50) => unwrap(supabase.from('issue_resolutions')
  .select('*').eq('device_id', device_id).order('created_at', { ascending: false })
  .order('id').range(...pageRange(page, size)));
