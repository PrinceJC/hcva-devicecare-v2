begin;
create schema if not exists devicecare_private;
revoke all on schema devicecare_private from public, anon, authenticated;
create table devicecare_private.admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create function public.devicecare_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from devicecare_private.admins where user_id = auth.uid());
$$;
revoke all on function public.devicecare_is_admin() from public, anon;
grant execute on function public.devicecare_is_admin() to authenticated;

create table public.va_people (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid unique references auth.users(id) on delete set null,
 full_name text not null check (length(trim(full_name)) between 1 and 150),
 email text not null default '',
 stage text not null default 'candidate' check (stage in ('candidate','active','inactive')),
 client_team text not null default '',
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
create table public.devices (
 id uuid primary key default gen_random_uuid(),
 person_id uuid not null references public.va_people(id),
 model text not null check (length(trim(model)) between 1 and 200),
 asset_tag text unique,
 device_type text not null default 'laptop' check (device_type in ('laptop','desktop','tablet','headset','other')),
 operating_system text not null default '',
 specifications text not null default '',
 notes text not null default '',
 next_due_date date not null default ((now() at time zone 'Asia/Manila')::date),
 last_inspected_on date,
 needs_attention boolean not null default false,
 archived boolean not null default false,
 created_at timestamptz not null default now()
);
create index devices_person_idx on public.devices(person_id);
create index devices_due_idx on public.devices(next_due_date) where not archived;
create table public.maintenance_checks (
 code text primary key,
 title text not null,
 description text not null,
 sort_order integer not null unique
);
insert into public.maintenance_checks values
 ('hardware','Hardware','Inspect casing, hinges, keyboard, ports, and charger.',1),
 ('battery','Battery and power','Verify battery condition and charging reliability.',2),
 ('storage','Storage health','Check available space and drive health.',3),
 ('os_updates','Operating system updates','Verify approved operating system updates.',4),
 ('security','Endpoint protection','Verify antivirus is active and current.',5),
 ('accounts','Account security','Verify screen lock and MFA on supported work accounts.',6),
 ('apps','Browsers and applications','Verify approved browsers and work applications are updated.',7),
 ('connectivity','Connectivity and peripherals','Test internet, webcam, microphone, and headset.',8),
 ('backup','Backup readiness','Verify approved backup processes without collecting patient data.',9),
 ('cleaning','External cleaning','Inspect ventilation and clean external surfaces safely.',10);
create table public.inspections (
 id uuid primary key,
 device_id uuid not null references public.devices(id),
 person_id uuid not null references public.va_people(id),
 inspected_on date not null,
 inspector_id uuid not null references auth.users(id),
 person_name_snapshot text not null,
 device_model_snapshot text not null,
 checklist_version integer not null default 1,
 results jsonb not null,
 findings text not null default '',
 has_failures boolean not null,
 next_due_date date not null,
 created_at timestamptz not null default now()
);
create index inspections_device_idx on public.inspections(device_id, inspected_on desc);
create index inspections_person_idx on public.inspections(person_id);
create table public.issue_resolutions (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.devices(id),
 resolved_by uuid not null references auth.users(id),
 resolution text not null check(length(trim(resolution)) > 0),
 created_at timestamptz not null default now()
);
create index resolutions_device_idx on public.issue_resolutions(device_id);

alter table public.va_people enable row level security;
alter table public.devices enable row level security;
alter table public.maintenance_checks enable row level security;
alter table public.inspections enable row level security;
alter table public.issue_resolutions enable row level security;
revoke all on public.va_people,public.devices,public.maintenance_checks,public.inspections,public.issue_resolutions from anon,authenticated;
grant select on public.va_people,public.devices,public.maintenance_checks,public.inspections,public.issue_resolutions to authenticated;
grant insert(full_name,auth_user_id,email,stage,client_team,archived),update(full_name,auth_user_id,email,stage,client_team,archived) on public.va_people to authenticated;
grant insert(person_id,model,asset_tag,device_type,operating_system,specifications,notes,next_due_date,archived),
 update(person_id,model,asset_tag,device_type,operating_system,specifications,notes,next_due_date,archived) on public.devices to authenticated;
create policy people_read on public.va_people for select to authenticated using (public.devicecare_is_admin() or auth_user_id=(select auth.uid()));
create policy people_insert on public.va_people for insert to authenticated with check(public.devicecare_is_admin());
create policy people_update on public.va_people for update to authenticated using(public.devicecare_is_admin()) with check(public.devicecare_is_admin());
create policy devices_read on public.devices for select to authenticated using(public.devicecare_is_admin() or exists(select 1 from public.va_people p where p.id=person_id and p.auth_user_id=(select auth.uid())));
create policy devices_insert on public.devices for insert to authenticated with check(public.devicecare_is_admin());
create policy devices_update on public.devices for update to authenticated using(public.devicecare_is_admin()) with check(public.devicecare_is_admin());
create policy checks_read on public.maintenance_checks for select to authenticated using(true);
-- History follows the person at the time of inspection, even if the device is reassigned.
create policy inspections_read on public.inspections for select to authenticated using(public.devicecare_is_admin() or exists(select 1 from public.va_people p where p.id=person_id and p.auth_user_id=(select auth.uid())));
create policy resolutions_read on public.issue_resolutions for select to authenticated using(public.devicecare_is_admin() or exists(select 1 from public.devices d join public.va_people p on p.id=d.person_id where d.id=device_id and p.auth_user_id=(select auth.uid())));

create function public.complete_inspection(
 p_request_id uuid, p_device_id uuid, p_inspected_on date, p_results jsonb, p_findings text default ''
) returns public.inspections
language plpgsql security definer set search_path = '' as $$
declare
 d public.devices; existing public.inspections; saved public.inspections;
 failed boolean; applicable boolean; due date; snapshot jsonb;
begin
 if auth.uid() is null or not public.devicecare_is_admin() then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_request_id is null or p_device_id is null then raise exception 'Request and device IDs are required'; end if;
 -- Serialize completions and attention resolutions for the same device.
 select * into d from public.devices where id=p_device_id for update;
 if not found then raise exception 'Device not found'; end if;
 select * into existing from public.inspections where id=p_request_id;
 if found then
  if existing.device_id<>p_device_id or existing.inspected_on is distinct from p_inspected_on
   or existing.findings is distinct from coalesce(p_findings,'')
   or (select jsonb_object_agg(x.key,x.value->>'result') from jsonb_each(existing.results) x) is distinct from p_results
  then raise exception 'Request ID already used for a different inspection'; end if;
  return existing;
 end if;
 if d.archived then raise exception 'Archived devices cannot be inspected'; end if;
 if exists(select 1 from public.va_people where id=d.person_id and archived) then raise exception 'Assigned person is archived'; end if;
 if p_inspected_on is null or p_inspected_on > (now() at time zone 'Asia/Manila')::date then
  raise exception 'Inspection date must not be in the future';
 end if;
 if d.last_inspected_on is not null and p_inspected_on < d.last_inspected_on then
  raise exception 'Inspection predates the latest inspection';
 end if;
 if p_results is null or jsonb_typeof(p_results)<>'object' then raise exception 'Results must be a JSON object'; end if;
 if (select count(*) from jsonb_object_keys(p_results))<>(select count(*) from public.maintenance_checks)
  or exists(select 1 from public.maintenance_checks c where not(p_results ? c.code)
   or jsonb_typeof(p_results->c.code)<>'string'
   or p_results->>c.code not in ('pass','fail','na'))
 then raise exception 'Provide pass, fail, or na for every checklist code'; end if;
 select bool_or(value='fail'),bool_or(value<>'na') into failed,applicable from jsonb_each_text(p_results);
 if not applicable then raise exception 'At least one check must be applicable'; end if;
 if failed and length(trim(coalesce(p_findings,'')))=0 then raise exception 'Failed checks require findings and follow-up actions'; end if;
 select jsonb_object_agg(c.code,jsonb_build_object('title',c.title,'description',c.description,'result',p_results->>c.code))
 into snapshot from public.maintenance_checks c;
 due := (p_inspected_on + interval '3 months')::date;
 insert into public.inspections(id,device_id,person_id,inspected_on,inspector_id,person_name_snapshot,device_model_snapshot,results,findings,has_failures,next_due_date)
 values(p_request_id,d.id,d.person_id,p_inspected_on,auth.uid(),(select full_name from public.va_people where id=d.person_id),d.model,snapshot,coalesce(p_findings,''),failed,due)
 returning * into saved;
 update public.devices set last_inspected_on=p_inspected_on,next_due_date=due,needs_attention=failed where id=d.id;
 return saved;
end;
$$;
revoke all on function public.complete_inspection(uuid,uuid,date,jsonb,text) from public,anon;
grant execute on function public.complete_inspection(uuid,uuid,date,jsonb,text) to authenticated;

create function public.resolve_device_issue(p_device_id uuid,p_resolution text) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.devices;
begin
 if auth.uid() is null or not public.devicecare_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if length(trim(coalesce(p_resolution,'')))=0 then raise exception 'Resolution notes required'; end if;
 select * into d from public.devices where id=p_device_id for update;
 if not found then raise exception 'Device not found'; end if;
 if not d.needs_attention then raise exception 'No outstanding issue'; end if;
 insert into public.issue_resolutions(device_id,resolved_by,resolution) values(d.id,auth.uid(),p_resolution);
 update public.devices set needs_attention=false where id=d.id;
end;
$$;
revoke all on function public.resolve_device_issue(uuid,text) from public,anon;
grant execute on function public.resolve_device_issue(uuid,text) to authenticated;

-- Invoker security preserves underlying RLS for dashboard and schedule queries.
create view public.device_schedule with (security_invoker=true) as
 select d.*,p.full_name,p.stage,
 d.next_due_date-(now() at time zone 'Asia/Manila')::date as days_until_due,
 case when d.next_due_date<(now() at time zone 'Asia/Manila')::date then 'overdue'
      when d.next_due_date<=(now() at time zone 'Asia/Manila')::date+30 then 'due_soon'
      else 'on_track' end as schedule_status
 from public.devices d join public.va_people p on p.id=d.person_id
 where not d.archived and not p.archived;
revoke all on public.device_schedule from anon,authenticated;
grant select on public.device_schedule to authenticated;
commit;
