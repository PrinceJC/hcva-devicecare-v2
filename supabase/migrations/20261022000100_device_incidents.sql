begin;

create table public.device_incidents (
 id uuid primary key,
 ticket_number bigint generated always as identity unique not null,
 person_id uuid not null references public.va_people(id),
 device_id uuid references public.devices(id),
 person_name_snapshot text not null,
 device_model_snapshot text not null default '',
 asset_tag_snapshot text not null default '',
 title text not null check(length(trim(title)) between 1 and 180),
 description text not null check(length(trim(description)) between 1 and 10000),
 category text not null check(category in ('hardware','software','network','access','other')),
 priority text not null check(priority in ('low','normal','high','urgent')),
 status text not null default 'open' check(status in ('open','in_progress','waiting_va','resolved','closed')),
 reported_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 resolved_at timestamptz,
 closed_at timestamptz,
 resolution text not null default '',
 created_by uuid not null references auth.users(id),
 created_by_email text not null,
 version integer not null default 1,
 creation_payload jsonb not null,
 search_text text generated always as
  (title || ' ' || description || ' ' || person_name_snapshot || ' ' || device_model_snapshot || ' ' || asset_tag_snapshot) stored,
 check(status not in ('resolved','closed') or length(trim(resolution))>0)
);
create index incidents_person_idx on public.device_incidents(person_id);
create index incidents_device_idx on public.device_incidents(device_id);
create index incidents_status_date_idx on public.device_incidents(status,reported_at desc,id);
create index incidents_reported_idx on public.device_incidents(reported_at desc,id);

create table public.incident_events (
 id uuid primary key default gen_random_uuid(),
 incident_id uuid not null references public.device_incidents(id),
 request_id uuid not null unique,
 event_type text not null check(event_type in ('created','update')),
 actor_id uuid not null references auth.users(id),
 actor_email text not null,
 from_status text,
 to_status text not null,
 from_priority text,
 to_priority text not null,
 note text not null default '',
 resolution text not null default '',
 request_payload jsonb not null,
 created_at timestamptz not null default now()
);
create index incident_events_incident_idx on public.incident_events(incident_id,created_at,id);

-- Internal IT support records. A separate VA submission portal is not enabled.
alter table public.device_incidents enable row level security;
alter table public.incident_events enable row level security;
revoke all on public.device_incidents,public.incident_events from public,anon,authenticated;
grant select on public.device_incidents,public.incident_events to authenticated;
revoke all on sequence public.device_incidents_ticket_number_seq from public,anon,authenticated;
create policy incident_admin_read on public.device_incidents for select to authenticated
 using(public.devicecare_is_admin());
create policy incident_event_admin_read on public.incident_events for select to authenticated
 using(public.devicecare_is_admin());

create function public.create_device_incident(
 p_request_id uuid,
 p_person_id uuid,
 p_title text,
 p_description text,
 p_category text default 'hardware',
 p_priority text default 'normal',
 p_device_id uuid default null,
 p_device_label text default '',
 p_reported_at timestamptz default null
) returns public.device_incidents
language plpgsql security definer set search_path = '' as $$
declare
 p public.va_people;
 d public.devices;
 saved public.device_incidents;
 payload jsonb;
 actor_email text;
 reported timestamptz;
begin
 if auth.uid() is null or not public.devicecare_is_admin() then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_request_id is null or p_person_id is null then raise exception 'Request ID and team member are required'; end if;
 payload:=jsonb_build_object('person_id',p_person_id,'device_id',p_device_id,
  'title',trim(p_title),'description',trim(p_description),'category',p_category,
  'priority',p_priority,'device_label',trim(coalesce(p_device_label,'')),'reported_at',p_reported_at);
 perform pg_advisory_xact_lock(hashtextextended('incident-create:'||p_request_id::text,0));
 select * into saved from public.device_incidents where id=p_request_id;
 if found then
  if saved.creation_payload is distinct from payload or saved.created_by<>auth.uid() then
   raise exception 'Request ID already used for a different incident';
  end if;
  return saved;
 end if;
 if p_title is null or length(trim(p_title)) not between 1 and 180 then raise exception 'Enter a title of 1 to 180 characters'; end if;
 if p_description is null or length(trim(p_description)) not between 1 and 10000 then raise exception 'Enter a description of 1 to 10000 characters'; end if;
 if p_category is null or p_category not in ('hardware','software','network','access','other') then raise exception 'Invalid incident category'; end if;
 if p_priority is null or p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid incident priority'; end if;
 if length(coalesce(p_device_label,''))>200 then raise exception 'Device details must be 200 characters or fewer'; end if;
 reported:=coalesce(p_reported_at,now());
 if reported>now()+interval '5 minutes' then raise exception 'Reported time cannot be in the future'; end if;
 select * into p from public.va_people where id=p_person_id for share;
 if not found or p.archived then raise exception 'Select a current team member'; end if;
 if p_device_id is not null then
  select * into d from public.devices where id=p_device_id for share;
  if not found or d.archived or d.person_id<>p_person_id then raise exception 'Select a current device assigned to this team member'; end if;
 end if;
 select coalesce(email,'IT administrator') into actor_email from auth.users where id=auth.uid();
 insert into public.device_incidents(id,person_id,device_id,person_name_snapshot,device_model_snapshot,
  asset_tag_snapshot,title,description,category,priority,reported_at,created_by,created_by_email,creation_payload)
 values(p_request_id,p.id,p_device_id,p.full_name,
  case when p_device_id is null then trim(coalesce(p_device_label,'')) else d.model end,
  case when p_device_id is null then '' else coalesce(d.asset_tag,'') end,
  trim(p_title),trim(p_description),p_category,p_priority,reported,auth.uid(),actor_email,payload)
 returning * into saved;
 insert into public.incident_events(incident_id,request_id,event_type,actor_id,actor_email,to_status,to_priority,note,request_payload)
 values(saved.id,p_request_id,'created',auth.uid(),actor_email,'open',p_priority,'Incident logged.',payload);
 return saved;
end;
$$;
revoke all on function public.create_device_incident(uuid,uuid,text,text,text,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.create_device_incident(uuid,uuid,text,text,text,text,uuid,text,timestamptz) to authenticated;

create function public.record_incident_update(
 p_request_id uuid,
 p_incident_id uuid,
 p_expected_version integer,
 p_status text,
 p_priority text,
 p_note text default '',
 p_resolution text default ''
) returns public.device_incidents
language plpgsql security definer set search_path = '' as $$
declare
 current_record public.device_incidents;
 saved public.device_incidents;
 previous_event public.incident_events;
 payload jsonb;
 actor_email text;
begin
 if auth.uid() is null or not public.devicecare_is_admin() then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if p_request_id is null or p_incident_id is null then raise exception 'Request ID and incident are required'; end if;
 payload:=jsonb_build_object('incident_id',p_incident_id,'expected_version',p_expected_version,
  'status',p_status,'priority',p_priority,'note',trim(coalesce(p_note,'')),
  'resolution',trim(coalesce(p_resolution,'')));
 perform pg_advisory_xact_lock(hashtextextended('incident-event:'||p_request_id::text,0));
 select * into current_record from public.device_incidents where id=p_incident_id for update;
 if not found then raise exception 'Incident not found'; end if;
 select * into previous_event from public.incident_events where request_id=p_request_id;
 if found then
  if previous_event.event_type<>'update' or previous_event.request_payload is distinct from payload or previous_event.actor_id<>auth.uid() then
   raise exception 'Request ID already used for a different update';
  end if;
  return current_record;
 end if;
 if p_expected_version is null or p_expected_version<>current_record.version then
  raise exception 'This incident changed. Reload the latest details before saving.' using errcode='40001';
 end if;
 if p_status is null or p_status not in ('open','in_progress','waiting_va','resolved','closed') then raise exception 'Invalid incident status'; end if;
 if p_priority is null or p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid incident priority'; end if;
 if length(coalesce(p_note,''))>10000 or length(coalesce(p_resolution,''))>10000 then raise exception 'Notes and resolution must be 10000 characters or fewer'; end if;
 if p_status in ('resolved','closed') and length(trim(coalesce(p_resolution,'')))=0 then raise exception 'Describe the resolution before resolving or closing the incident'; end if;
 if p_status not in ('resolved','closed') and length(trim(coalesce(p_resolution,'')))>0 then raise exception 'Use the troubleshooting note for ongoing work. Resolution is for resolved or closed incidents.'; end if;
 if p_status=current_record.status and p_priority=current_record.priority
  and trim(coalesce(p_resolution,''))=current_record.resolution and length(trim(coalesce(p_note,'')))=0
 then raise exception 'Add a note or change the incident status or priority'; end if;
 select coalesce(email,'IT administrator') into actor_email from auth.users where id=auth.uid();
 update public.device_incidents set
  status=p_status,priority=p_priority,resolution=trim(coalesce(p_resolution,'')),
  resolved_at=case when p_status in ('resolved','closed') then coalesce(current_record.resolved_at,now()) else null end,
  closed_at=case when p_status='closed' then coalesce(current_record.closed_at,now()) else null end,
  updated_at=now(),version=current_record.version+1
 where id=current_record.id returning * into saved;
 insert into public.incident_events(incident_id,request_id,event_type,actor_id,actor_email,
  from_status,to_status,from_priority,to_priority,note,resolution,request_payload)
 values(saved.id,p_request_id,'update',auth.uid(),actor_email,current_record.status,p_status,
  current_record.priority,p_priority,trim(coalesce(p_note,'')),saved.resolution,payload);
 return saved;
end;
$$;
revoke all on function public.record_incident_update(uuid,uuid,integer,text,text,text,text) from public,anon;
grant execute on function public.record_incident_update(uuid,uuid,integer,text,text,text,text) to authenticated;
commit;
