-- HighCall VA ATS, added to the shared HCVA project alongside DeviceCare.
--
-- Additive only: DeviceCare's tables, functions, policies and grants are not changed.
-- Everything here is prefixed ats_ (tables and functions) or lives in ats_private.
-- Auth is shared: one HCVA login can be a DeviceCare admin, an ATS recruiter, both, or neither.
-- ATS access comes only from public.ats_staff, never from devicecare_private.admins.
begin;

create schema if not exists ats_private;
revoke all on schema ats_private from public, anon, authenticated;

------------------------------------------------------------
-- Team access
------------------------------------------------------------
create table public.ats_staff (
 user_id    uuid primary key references auth.users(id) on delete cascade,
 email      text not null,
 name       text,
 role       text not null check (role in ('admin','recruiter','member')),
 created_at timestamptz not null default now()
);
comment on table public.ats_staff is 'HighCall VA ATS access. admin: everything plus team. recruiter: roles, pool, screening. member: sees internal roles and can apply.';

create function ats_private.staff_role() returns text
language sql stable security definer set search_path = '' as $$
 select role from public.ats_staff where user_id = auth.uid();
$$;
create function public.ats_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
 select ats_private.staff_role() is not null;
$$;
create function public.ats_is_recruiter() returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(ats_private.staff_role() in ('admin','recruiter'), false);
$$;
create function public.ats_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce(ats_private.staff_role() = 'admin', false);
$$;
revoke all on function ats_private.staff_role() from public, anon, authenticated;
revoke all on function public.ats_is_staff(), public.ats_is_recruiter(), public.ats_is_admin() from public, anon;
grant execute on function public.ats_is_staff(), public.ats_is_recruiter(), public.ats_is_admin() to authenticated;

------------------------------------------------------------
-- Roles (job openings)
------------------------------------------------------------
create table public.ats_roles (
 id              uuid primary key default gen_random_uuid(),
 title           text not null check (length(trim(title)) between 1 and 200),
 department      text,
 employment_type text not null default 'Full-time',
 location        text default 'Remote',
 schedule        text,
 compensation    text,
 description     text,
 requirements    text,
 min_download    numeric,
 min_ram         numeric,
 need_backup     boolean not null default true,
 status          text not null default 'draft' check (status in ('draft','public','internal','archived')),
 posted_at       timestamptz,
 archived_at     timestamptz,
 created_by      uuid default auth.uid() references auth.users(id) on delete set null,
 created_at      timestamptz not null default now(),
 updated_at      timestamptz not null default now()
);
create index ats_roles_status_idx on public.ats_roles(status);

-- Kept apart from roles so the public careers page never sees screening questions.
-- role_id null = talent pool questions.
create table public.ats_screening_templates (
 id         uuid primary key default gen_random_uuid(),
 role_id    uuid references public.ats_roles(id) on delete cascade,
 questions  jsonb not null default '[]'::jsonb,
 updated_at timestamptz not null default now(),
 constraint ats_screening_templates_role_key unique nulls not distinct (role_id)
);

------------------------------------------------------------
-- Candidates (talent pool)
------------------------------------------------------------
create table public.ats_candidates (
 id           uuid primary key default gen_random_uuid(),
 name         text not null check (length(trim(name)) between 1 and 200),
 email        text,
 phone        text,
 location     text,
 headline     text,
 years        numeric,
 availability text,
 rate         text,
 skills       text[] not null default '{}',
 link         text,
 note         text,
 cv_path      text,
 cv_name      text,
 cv_text      text,
 source       text not null default 'self' check (source in ('self','recruiter')),
 device       jsonb not null default '{}'::jsonb,
 -- Set when a hired candidate is handed over to DeviceCare.
 va_person_id uuid references public.va_people(id) on delete set null,
 created_by   uuid default auth.uid() references auth.users(id) on delete set null,
 created_at   timestamptz not null default now(),
 updated_at   timestamptz not null default now()
);
create unique index ats_candidates_email_key on public.ats_candidates(lower(email)) where email is not null;
create index ats_candidates_va_person_idx on public.ats_candidates(va_person_id);

------------------------------------------------------------
-- Pipeline: a candidate in a role (role_id null = pool screening)
------------------------------------------------------------
create table public.ats_pipeline (
 id           uuid primary key default gen_random_uuid(),
 candidate_id uuid not null references public.ats_candidates(id) on delete cascade,
 role_id      uuid references public.ats_roles(id) on delete cascade,
 stage        text check (stage is null or stage in ('Sourced','Applied','Screening','Interview','Offer','Hired','Rejected')),
 rating       integer not null default 0 check (rating between 0 and 5),
 answers      jsonb not null default '{}'::jsonb,
 notes        text,
 source       text not null default 'applied' check (source in ('applied','sourced','recruiter')),
 created_at   timestamptz not null default now(),
 updated_at   timestamptz not null default now(),
 constraint ats_pipeline_candidate_role_key unique nulls not distinct (candidate_id, role_id)
);
create index ats_pipeline_role_idx on public.ats_pipeline(role_id);

------------------------------------------------------------
-- Settings (key/value). is_public rows are readable by anyone.
------------------------------------------------------------
create table public.ats_settings (
 key        text primary key,
 value      jsonb,
 is_public  boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into public.ats_settings(key, value, is_public) values
 ('careers_intro', to_jsonb('Work from home with clients in the US and around the world. We look for virtual assistants who are dependable, well set up, and great with people.'::text), true);

insert into public.ats_screening_templates(role_id, questions) values
 (null, '[{"id":"d0","text":"What VA work have you done before, and for which industries?"},{"id":"d1","text":"Which time zone and shift can you commit to?"},{"id":"d2","text":"Which tools are you comfortable with (CRM, Google Workspace, dialers)?"}]');

------------------------------------------------------------
-- updated_at
------------------------------------------------------------
create function ats_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function ats_private.touch_updated_at() from public, anon, authenticated;
create trigger ats_roles_touch      before update on public.ats_roles               for each row execute function ats_private.touch_updated_at();
create trigger ats_templates_touch  before update on public.ats_screening_templates for each row execute function ats_private.touch_updated_at();
create trigger ats_candidates_touch before update on public.ats_candidates          for each row execute function ats_private.touch_updated_at();
create trigger ats_pipeline_touch   before update on public.ats_pipeline            for each row execute function ats_private.touch_updated_at();
create trigger ats_settings_touch   before update on public.ats_settings            for each row execute function ats_private.touch_updated_at();

------------------------------------------------------------
-- Grants and row level security
------------------------------------------------------------
alter table public.ats_staff               enable row level security;
alter table public.ats_roles               enable row level security;
alter table public.ats_screening_templates enable row level security;
alter table public.ats_candidates          enable row level security;
alter table public.ats_pipeline            enable row level security;
alter table public.ats_settings            enable row level security;

revoke all on public.ats_staff, public.ats_roles, public.ats_screening_templates,
 public.ats_candidates, public.ats_pipeline, public.ats_settings from public, anon, authenticated;
grant select on public.ats_roles, public.ats_settings to anon;
grant select, insert, update, delete on public.ats_staff, public.ats_roles, public.ats_screening_templates,
 public.ats_candidates, public.ats_pipeline, public.ats_settings to authenticated;

create policy ats_staff_read  on public.ats_staff for select to authenticated using (user_id = (select auth.uid()) or public.ats_is_recruiter());
create policy ats_staff_admin on public.ats_staff for all    to authenticated using (public.ats_is_admin()) with check (public.ats_is_admin());

create policy ats_roles_public_read on public.ats_roles for select to anon using (status = 'public');
create policy ats_roles_read        on public.ats_roles for select to authenticated
 using (status = 'public' or (status = 'internal' and public.ats_is_staff()) or public.ats_is_recruiter());
create policy ats_roles_write       on public.ats_roles for all to authenticated using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());

create policy ats_templates_recruiters  on public.ats_screening_templates for all to authenticated using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());
create policy ats_candidates_recruiters on public.ats_candidates          for all to authenticated using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());
create policy ats_pipeline_recruiters   on public.ats_pipeline            for all to authenticated using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());

create policy ats_settings_public_read on public.ats_settings for select to anon using (is_public);
create policy ats_settings_read        on public.ats_settings for select to authenticated using (is_public or public.ats_is_recruiter());
create policy ats_settings_write       on public.ats_settings for all to authenticated using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());

------------------------------------------------------------
-- Public application endpoint (candidates never touch tables directly)
------------------------------------------------------------
create function public.ats_submit_application(p_role uuid, p_data jsonb) returns void
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

------------------------------------------------------------
-- Team management (ATS admins). The person must already have an HCVA login.
------------------------------------------------------------
create function public.ats_add_staff(p_email text, p_role text, p_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_email text;
begin
 if auth.uid() is null or not public.ats_is_admin() then
  raise exception 'Only ATS admins can add team members' using errcode = '42501';
 end if;
 if p_role is null or p_role not in ('admin','recruiter','member') then
  raise exception 'Unknown access level' using errcode = '22023';
 end if;
 select id, email into v_uid, v_email from auth.users where lower(email) = lower(trim(p_email));
 if v_uid is null then
  raise exception 'No HCVA login uses that email yet. Create it in Supabase under Authentication, Users first.' using errcode = 'P0002';
 end if;
 insert into public.ats_staff(user_id, email, role, name) values (v_uid, v_email, p_role, nullif(trim(p_name), ''))
 on conflict (user_id) do update set role = excluded.role, name = coalesce(excluded.name, public.ats_staff.name);
end;
$$;
revoke all on function public.ats_add_staff(text, text, text) from public, anon;
grant execute on function public.ats_add_staff(text, text, text) to authenticated;

------------------------------------------------------------
-- Hand a hired candidate over to DeviceCare.
-- Adds one row to public.va_people (or links an existing one with the same email).
-- Never edits or deletes DeviceCare data.
------------------------------------------------------------
create function public.ats_send_to_devicecare(p_candidate_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.ats_candidates; v_person uuid;
begin
 if auth.uid() is null or not public.ats_is_recruiter() then
  raise exception 'Recruiter access required' using errcode = '42501';
 end if;
 select * into c from public.ats_candidates where id = p_candidate_id for update;
 if not found then raise exception 'Candidate not found'; end if;
 if not exists (select 1 from public.ats_pipeline where candidate_id = c.id and stage = 'Hired') then
  raise exception 'Move the candidate to Hired before adding them to DeviceCare';
 end if;
 if c.va_person_id is not null and exists (select 1 from public.va_people where id = c.va_person_id) then
  return c.va_person_id;
 end if;
 if c.email is not null then
  select id into v_person from public.va_people
  where lower(email) = lower(c.email) and not archived order by created_at limit 1;
 end if;
 if v_person is null then
  insert into public.va_people(full_name, email, stage)
  values (left(trim(c.name), 150), coalesce(c.email, ''), 'active')
  returning id into v_person;
 end if;
 update public.ats_candidates set va_person_id = v_person where id = c.id;
 return v_person;
end;
$$;
revoke all on function public.ats_send_to_devicecare(uuid) from public, anon;
grant execute on function public.ats_send_to_devicecare(uuid) to authenticated;

------------------------------------------------------------
-- CV storage: private bucket, PDF only, 20 MB
------------------------------------------------------------
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ats-cvs', 'ats-cvs', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "ats-cvs applicants upload" on storage.objects for insert to anon, authenticated
 with check (bucket_id = 'ats-cvs' and (storage.foldername(name))[1] = 'applications');
create policy "ats-cvs recruiters upload" on storage.objects for insert to authenticated
 with check (bucket_id = 'ats-cvs' and public.ats_is_recruiter());
create policy "ats-cvs recruiters read" on storage.objects for select to authenticated
 using (bucket_id = 'ats-cvs' and public.ats_is_recruiter());
create policy "ats-cvs recruiters delete" on storage.objects for delete to authenticated
 using (bucket_id = 'ats-cvs' and public.ats_is_recruiter());

commit;
