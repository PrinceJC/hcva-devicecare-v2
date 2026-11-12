-- HighCall VA ATS: one record per email, with CV history.
-- Additive only. Touches ats_ objects only; DeviceCare is not changed.
--  * Re-applying with the same email (any capitalization) updates the existing candidate.
--  * A new CV replaces the current one; the old CV is kept in cv_history (latest 10).
begin;

alter table public.ats_candidates add column if not exists cv_history jsonb not null default '[]'::jsonb;
alter table public.ats_candidates add column if not exists last_applied_at timestamptz;
update public.ats_candidates set last_applied_at = created_at where last_applied_at is null and source = 'self';

-- Safety net: one candidate per email, whatever the capitalization or spacing.
update public.ats_candidates set email = lower(trim(email)) where email is not null and email <> lower(trim(email))
 and not exists (select 1 from public.ats_candidates o where o.id <> ats_candidates.id and lower(o.email) = lower(trim(ats_candidates.email)));

create or replace function public.ats_submit_application(p_role uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
 v_name   text := left(nullif(trim(p_data->>'name'), ''), 200);
 v_email  text := lower(nullif(trim(p_data->>'email'), ''));
 v_cv     text := nullif(p_data->>'cv_path', '');
 v_status text;
 v_skills text[] := '{}';
 v_years  numeric;
 v_link   text := nullif(trim(p_data->>'link'), '');
 v_cand   uuid;
begin
 if p_data is null or jsonb_typeof(p_data) <> 'object' then
  raise exception 'Application details are required' using errcode = '22023';
 end if;
 if v_name is null then
  raise exception 'Name is required' using errcode = '22023';
 end if;
 if v_email is null or length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
  raise exception 'A valid email is required' using errcode = '22023';
 end if;
 if p_role is not null then
  select status into v_status from public.ats_roles where id = p_role;
  if v_status is null or not (v_status = 'public' or (v_status = 'internal' and public.ats_is_staff())) then
   raise exception 'This role is not open for applications' using errcode = '22023';
  end if;
 end if;
 if v_cv is not null then
  if v_cv !~ '^applications/[0-9a-f-]{36}\.pdf$'
     or not exists (select 1 from storage.objects where bucket_id = 'ats-cvs' and name = v_cv) then
   raise exception 'CV upload not found' using errcode = '22023';
  end if;
 end if;
 if jsonb_typeof(p_data->'skills') = 'array' then
  select coalesce(array_agg(s), '{}') into v_skills
  from (select left(trim(x), 60) s from jsonb_array_elements_text(p_data->'skills') x where trim(x) <> '' limit 40) t;
 end if;
 if (p_data->>'years') ~ '^\d{1,2}(\.\d+)?$' then v_years := (p_data->>'years')::numeric; end if;
 if v_link is not null and v_link !~* '^https?://' then v_link := null; end if;

 insert into public.ats_candidates as c
  (name, email, phone, location, headline, years, availability, rate, skills, link, note, cv_path, cv_name, cv_text, source, created_by)
 values
  (v_name, v_email, left(p_data->>'phone', 50), left(p_data->>'location', 200), left(p_data->>'headline', 200),
   v_years, left(p_data->>'availability', 40), left(p_data->>'rate', 60), v_skills, left(v_link, 500),
   left(p_data->>'note', 4000), v_cv, left(p_data->>'cv_name', 200), left(p_data->>'cv_text', 60000), 'self', null)
 on conflict ((lower(email))) where email is not null do update set
  name         = excluded.name,
  phone        = coalesce(excluded.phone, c.phone),
  location     = coalesce(excluded.location, c.location),
  headline     = coalesce(excluded.headline, c.headline),
  years        = coalesce(excluded.years, c.years),
  availability = coalesce(excluded.availability, c.availability),
  rate         = coalesce(excluded.rate, c.rate),
  skills       = case when cardinality(excluded.skills) > 0 then excluded.skills else c.skills end,
  link         = coalesce(excluded.link, c.link),
  note         = coalesce(excluded.note, c.note),
  -- keep the replaced CV as a previous version (latest 10) instead of losing it
  cv_history   = case when excluded.cv_path is not null and c.cv_path is not null and excluded.cv_path <> c.cv_path
                      then (select coalesce(jsonb_agg(h order by ord), '[]'::jsonb) from (
                              select h, ord from jsonb_array_elements(c.cv_history || jsonb_build_array(jsonb_build_object(
                                'path', c.cv_path, 'name', c.cv_name, 'replaced_at', now()))) with ordinality as x(h, ord)
                              order by ord desc limit 10) t)
                      else c.cv_history end,
  last_applied_at = now(),
  cv_path      = coalesce(excluded.cv_path, c.cv_path),
  cv_name      = coalesce(excluded.cv_name, c.cv_name),
  cv_text      = case when excluded.cv_path is not null then excluded.cv_text else c.cv_text end
 returning c.id into v_cand;

 insert into public.ats_pipeline(candidate_id, role_id, stage, source)
 values (v_cand, p_role, case when p_role is null then null else 'Applied' end, 'applied')
 on conflict on constraint ats_pipeline_candidate_role_key do nothing;
end;
$$;
revoke all on function public.ats_submit_application(uuid, jsonb) from public;
grant execute on function public.ats_submit_application(uuid, jsonb) to anon, authenticated;

commit;
