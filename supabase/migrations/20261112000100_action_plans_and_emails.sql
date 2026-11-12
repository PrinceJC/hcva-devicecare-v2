begin;
create table public.action_email_settings (
 id boolean primary key default true check(id),
 email_enabled boolean not null default false,
 reminders_enabled boolean not null default false,
 sender_email text not null default '',
 reply_to_email text not null default '',
 ceo_email text not null default '',
 coo_email text not null default '',
 hr_email text not null default '',
 version integer not null default 1,
 updated_at timestamptz not null default now()
);
insert into public.action_email_settings(id) values(true);
create table public.device_action_plans (
 id uuid primary key default gen_random_uuid(),
 inspection_id uuid not null unique references public.inspections(id),
 person_id uuid not null references public.va_people(id),
 device_id uuid not null references public.devices(id),
 person_name text not null,
 device_name text not null,
 findings text not null default '',
 failed_checks text not null,
 title text not null default 'Device assessment follow-up',
 required_actions text not null default '',
 recipient_email text not null default '',
 due_date date,
 status text not null default 'draft' check(status in ('draft','awaiting_action','submitted_for_recheck','completed','cancelled')),
 revision integer not null default 0,
 version integer not null default 1,
 approved_payload jsonb,
 approved_at timestamptz,
 approved_by uuid references auth.users(id),
 recheck_inspection_id uuid references public.inspections(id),
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index action_plans_status_due on public.device_action_plans(status,due_date);
create table public.action_plan_events (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.device_action_plans(id),
 event_type text not null,
 actor_id uuid references auth.users(id),
 note text not null,
 created_at timestamptz not null default now()
);
create index action_events_plan on public.action_plan_events(plan_id,created_at,id);
create table public.action_email_queue (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.device_action_plans(id),
 revision integer not null,
 kind text not null check(kind in ('initial','before_due','due_today','overdue')),
 payload jsonb not null,
 status text not null default 'queued' check(status in ('queued','sending','accepted','failed','unknown','cancelled')),
 due_at timestamptz not null default now(),
 next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 lease_until timestamptz,
 lock_token uuid,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now(),
 accepted_at timestamptz,
 unique(plan_id,revision,kind)
);
create index action_queue_ready on public.action_email_queue(status,due_at,next_attempt_at);

alter table public.action_email_settings enable row level security;
alter table public.device_action_plans enable row level security;
alter table public.action_plan_events enable row level security;
alter table public.action_email_queue enable row level security;
revoke all on public.action_email_settings,public.device_action_plans,public.action_plan_events,public.action_email_queue from public,anon,authenticated;
grant select on public.action_email_settings,public.device_action_plans,public.action_plan_events,public.action_email_queue to authenticated;
create policy action_settings_read on public.action_email_settings for select to authenticated using(public.devicecare_is_admin());
create policy action_plans_read on public.device_action_plans for select to authenticated using(public.devicecare_is_admin());
create policy action_events_read on public.action_plan_events for select to authenticated using(public.devicecare_is_admin());
create policy action_queue_read on public.action_email_queue for select to authenticated using(public.devicecare_is_admin());

create function devicecare_private.valid_email(p_email text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$',false) and length(p_email)<=254;
$$;
create function devicecare_private.require_admin() returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.devicecare_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
end; $$;

create function public.save_action_email_settings(p_expected_version integer,p_email_enabled boolean,p_reminders_enabled boolean,p_sender_email text,p_reply_to_email text,p_ceo_email text,p_coo_email text,p_hr_email text)
returns public.action_email_settings language plpgsql security definer set search_path='' as $$
declare saved public.action_email_settings;
begin
 perform devicecare_private.require_admin();
 select * into saved from public.action_email_settings where id for update;
 if saved.version is distinct from p_expected_version then raise exception 'Settings changed. Reload before saving.'; end if;
 if p_email_enabled is null or p_reminders_enabled is null then raise exception 'Choose email and reminder settings'; end if;
 if p_email_enabled and not (
  devicecare_private.valid_email(trim(p_sender_email)) and devicecare_private.valid_email(trim(p_reply_to_email)) and
  devicecare_private.valid_email(trim(p_ceo_email)) and devicecare_private.valid_email(trim(p_coo_email)) and devicecare_private.valid_email(trim(p_hr_email))
 ) then raise exception 'Enter valid sender, reply-to, CEO, COO and HR email addresses before enabling email'; end if;
 update public.action_email_settings set email_enabled=p_email_enabled,reminders_enabled=p_reminders_enabled,
 sender_email=trim(coalesce(p_sender_email,'')),reply_to_email=trim(coalesce(p_reply_to_email,'')),ceo_email=trim(coalesce(p_ceo_email,'')),coo_email=trim(coalesce(p_coo_email,'')),hr_email=trim(coalesce(p_hr_email,'')),
 version=version+1,updated_at=now() where id returning * into saved;
 return saved;
end; $$;

create function devicecare_private.draft_failed_inspection() returns trigger
language plpgsql security definer set search_path='' as $$
declare failed text;
begin
 if not new.has_failures then return new; end if;
 select string_agg('- '||coalesce(x.value->>'title',x.key),E'\n' order by x.key) into failed
 from jsonb_each(new.results) x where x.value->>'result'='fail';
 insert into public.device_action_plans(inspection_id,person_id,device_id,person_name,device_name,findings,failed_checks,recipient_email)
 values(new.id,new.person_id,new.device_id,new.person_name_snapshot,new.device_model_snapshot,new.findings,coalesce(failed,'Review failed assessment.'),coalesce((select email from public.va_people where id=new.person_id),'')) on conflict(inspection_id) do nothing;
 return new;
end; $$;
create trigger inspection_action_draft after insert on public.inspections for each row execute function devicecare_private.draft_failed_inspection();
insert into public.device_action_plans(inspection_id,person_id,device_id,person_name,device_name,findings,failed_checks,recipient_email)
 select i.id,i.person_id,i.device_id,i.person_name_snapshot,i.device_model_snapshot,i.findings,
 coalesce((select string_agg('- '||coalesce(x.value->>'title',x.key),E'\n' order by x.key) from jsonb_each(i.results)x where x.value->>'result'='fail'),'Review failed assessment.'),coalesce(p.email,'')
 from public.inspections i join public.va_people p on p.id=i.person_id where i.has_failures on conflict(inspection_id) do nothing;

create function public.save_device_action_plan(p_id uuid,p_expected_version integer,p_title text,p_required_actions text,p_recipient_email text,p_due_date date)
returns public.device_action_plans language plpgsql security definer set search_path='' as $$
declare saved public.device_action_plans;
begin
 perform devicecare_private.require_admin();
 select * into saved from public.device_action_plans where id=p_id for update;
 if not found then raise exception 'Action plan not found'; end if;
 if saved.version is distinct from p_expected_version then raise exception 'Plan changed. Reload before saving.'; end if;
 if saved.status<>'draft' then raise exception 'Return the plan to draft before changing its requirements'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 180 or p_title ~ E'[\r\n]' then raise exception 'Enter a one-line title of 1 to 180 characters'; end if;
 if p_required_actions is null or length(trim(p_required_actions)) not between 1 and 10000 then raise exception 'Describe the required actions'; end if;
 if not devicecare_private.valid_email(trim(p_recipient_email)) then raise exception 'Enter a valid VA email address'; end if;
 if p_due_date is null or p_due_date<(now() at time zone 'Asia/Manila')::date then raise exception 'Set a deadline of today or later in Manila time'; end if;
 update public.device_action_plans set title=trim(p_title),required_actions=trim(p_required_actions),recipient_email=trim(p_recipient_email),due_date=p_due_date,version=version+1,updated_at=now() where id=p_id returning * into saved;
 insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(p_id,'draft_saved',auth.uid(),'IT updated the required actions, recipient and deadline.');
 return saved;
end; $$;

create function devicecare_private.compose_action_email(p public.device_action_plans,p_kind text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.action_email_settings; cc_list jsonb; subject_line text; body text;
begin
 select * into s from public.action_email_settings where id;
 if not s.email_enabled then raise exception 'Enable email in Email Settings after configuring the sender and leadership recipients'; end if;
 if not devicecare_private.valid_email(p.recipient_email) or p.due_date is null or length(trim(p.required_actions))=0 then raise exception 'Save the VA email, required actions and deadline first'; end if;
 select coalesce(jsonb_agg(email order by email),'[]'::jsonb) into cc_list from
 (select distinct lower(email) email from unnest(array[s.ceo_email,s.coo_email,s.hr_email])email where lower(email)<>lower(p.recipient_email))q;
 subject_line:=case p_kind when 'initial' then 'Action required: ' when 'before_due' then 'Reminder: ' when 'due_today' then 'Due today: ' else 'Overdue action: ' end || p.title;
 body:=format(E'Hi %s,\n\nYour HCVA DeviceCare assessment identified items requiring action.\n\nDevice: %s\nFailed checks:\n%s\n\nIT findings:\n%s\n\nRequired actions:\n%s\n\nDeadline: %s, by 11:59 PM (Manila time).\n\n%s\n\nPlease reply to this email or contact HCVA IT when the actions are complete so we can arrange a recheck. IT will verify completion before closing this action plan.\n\nRegards,\nHCVA IT Support',
 p.person_name,p.device_name,p.failed_checks,p.findings,p.required_actions,to_char(p.due_date,'FMMonth DD, YYYY'),
 case p_kind when 'before_due' then 'This is a reminder that your deadline is approaching.' when 'due_today' then 'The deadline for these actions is today.' when 'overdue' then 'The deadline has passed. Please contact HCVA IT with an update; leadership and HR are copied for follow-up.' else 'The CEO, COO and HR are copied for visibility and follow-up.' end);
 return jsonb_build_object('from','HCVA IT Support <'||s.sender_email||'>','to',jsonb_build_array(p.recipient_email),'cc',cc_list,'reply_to',s.reply_to_email,'subject',subject_line,'text',body);
end; $$;
create function public.preview_device_action_email(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.device_action_plans; v integer;
begin
 perform devicecare_private.require_admin();
 select * into p from public.device_action_plans where id=p_id;
 if not found or p.status<>'draft' then raise exception 'Select a saved draft plan'; end if;
 select version into v from public.action_email_settings where id;
 return jsonb_build_object('plan_version',p.version,'settings_version',v,'payload',devicecare_private.compose_action_email(p,'initial'));
end; $$;
create function public.approve_device_action_plan(p_id uuid,p_expected_version integer,p_settings_version integer)
returns public.device_action_plans language plpgsql security definer set search_path='' as $$
declare p public.device_action_plans; payload jsonb; s public.action_email_settings;
begin
 perform devicecare_private.require_admin();
 select * into p from public.device_action_plans where id=p_id for update;
 select * into s from public.action_email_settings where id for share;
 if p.id is null then raise exception 'Action plan not found'; end if;
 if p.version is distinct from p_expected_version or s.version is distinct from p_settings_version then raise exception 'Plan or recipients changed. Preview the email again.'; end if;
 if p.status<>'draft' then raise exception 'This plan has already been approved or cancelled'; end if;
 if p.due_date<(now() at time zone 'Asia/Manila')::date then raise exception 'The deadline has passed. Save a new deadline first.'; end if;
 payload:=devicecare_private.compose_action_email(p,'initial');
 update public.device_action_plans set status='awaiting_action',revision=revision+1,approved_payload=payload,approved_at=now(),approved_by=auth.uid(),version=version+1,updated_at=now() where id=p_id returning * into p;
 insert into public.action_email_queue(plan_id,revision,kind,payload) values(p.id,p.revision,'initial',payload);
 insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(p_id,'approved',auth.uid(),'IT approved the action plan and queued the reviewed email.');
 return p;
end; $$;

create function public.change_device_action_status(p_id uuid,p_expected_version integer,p_status text,p_note text,p_recheck_id uuid default null)
returns public.device_action_plans language plpgsql security definer set search_path='' as $$
declare p public.device_action_plans; checkup public.inspections;
begin
 perform devicecare_private.require_admin();
 select * into p from public.device_action_plans where id=p_id for update;
 if not found then raise exception 'Action plan not found'; end if;
 if p.version is distinct from p_expected_version then raise exception 'Plan changed. Reload first.'; end if;
 if p_note is null or length(trim(p_note)) not between 1 and 10000 then raise exception 'Add a note explaining this update'; end if;
 if exists(select 1 from public.action_email_queue where plan_id=p_id and status='sending' and lease_until>now()) then raise exception 'An email is being sent. Retry this update in a few minutes.'; end if;
 if p_status='draft' then
  if p.status not in ('awaiting_action','submitted_for_recheck') then raise exception 'Only an active plan can be returned to draft'; end if;
 elsif p_status='submitted_for_recheck' then
  if p.status<>'awaiting_action' then raise exception 'Only an awaiting-action plan can be submitted for recheck'; end if;
 elsif p_status='awaiting_action' then
  if p.status<>'submitted_for_recheck' then raise exception 'Only a submitted plan can return to awaiting action'; end if;
 elsif p_status='completed' then
  if p.status not in ('awaiting_action','submitted_for_recheck') then raise exception 'Only an active plan can be completed'; end if;
  select * into checkup from public.inspections where id=p_recheck_id;
  if not found or checkup.has_failures or checkup.device_id<>p.device_id
   or checkup.created_at<p.created_at or checkup.inspected_on<(select inspected_on from public.inspections where id=p.inspection_id)
  then raise exception 'Select a later passing inspection for this same device'; end if;
 elsif p_status='cancelled' then
  if p.status in ('completed','cancelled') then raise exception 'This plan is already final'; end if;
 else raise exception 'Invalid action plan transition'; end if;
 if p_status<>'awaiting_action' then
  update public.action_email_queue set status=case when attempts>0 then 'unknown' else 'cancelled' end,last_error=case when attempts>0 then 'Plan changed after a send attempt. Check provider history before arranging another notification.' else 'Cancelled after an action plan status change.' end where plan_id=p_id and status in ('queued','sending');
 end if;
 update public.device_action_plans set status=p_status,version=version+1,updated_at=now(),
 recheck_inspection_id=case when p_status='completed' then p_recheck_id else recheck_inspection_id end,
 completed_at=case when p_status='completed' then now() else completed_at end
 where id=p_id returning * into p;
 insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(p_id,p_status,auth.uid(),trim(p_note));
 return p;
end; $$;

-- Scheduler/worker functions are executable only with the server-side service role.
create function public.enqueue_action_reminders() returns integer
language plpgsql security definer set search_path='' as $$
declare p public.device_action_plans; email_kind text; payload jsonb; count_added integer:=0; n integer; today date:=(now() at time zone 'Asia/Manila')::date;
begin
 if not exists(select 1 from public.action_email_settings where id and email_enabled and reminders_enabled) then return 0; end if;
 for p in select * from public.device_action_plans where status='awaiting_action' and due_date is not null for update loop
  if not exists(select 1 from public.action_email_queue where plan_id=p.id and revision=p.revision and kind='initial' and status='accepted') then continue; end if;
  -- Only the appropriate current-day message is generated after downtime.
  email_kind:=case when today>p.due_date then 'overdue' when today=p.due_date then 'due_today' when today>=p.due_date-3 then 'before_due' else null end;
  if email_kind is null or (now() at time zone 'Asia/Manila')::time<time '09:00' then continue; end if;
  payload:=devicecare_private.compose_action_email(p,email_kind);
  -- Reminders retain the exact recipients/sender approved by IT, even if settings change.
  payload:=payload || jsonb_build_object('from',p.approved_payload->'from','to',p.approved_payload->'to','cc',p.approved_payload->'cc','reply_to',p.approved_payload->'reply_to');
  insert into public.action_email_queue(plan_id,revision,kind,payload) values(p.id,p.revision,email_kind,payload) on conflict(plan_id,revision,kind) do nothing;
  get diagnostics n=row_count; count_added:=count_added+n;
 end loop;
 return count_added;
end; $$;
create function public.claim_action_email(p_only_id uuid default null) returns setof public.action_email_queue
language plpgsql security definer set search_path='' as $$
declare q public.action_email_queue; p public.device_action_plans;
begin
 if not exists(select 1 from public.action_email_settings where id and email_enabled) then return; end if;
 for q in select * from public.action_email_queue where
  (p_only_id is null or id=p_only_id) and due_at<=now() and next_attempt_at<=now()
  and (status='queued' or (status='sending' and lease_until<now())) order by created_at loop
  select * into p from public.device_action_plans where id=q.plan_id for update skip locked;
  if not found then continue; end if;
  select * into q from public.action_email_queue where id=q.id for update skip locked;
  if not found then continue; end if;
  if not (q.status='queued' or (q.status='sending' and q.lease_until<now())) then continue; end if;
  if p.status<>'awaiting_action' or p.revision<>q.revision then
   update public.action_email_queue set status=case when attempts>0 then 'unknown' else 'cancelled' end,last_error='Plan is no longer awaiting action at this revision. Reconcile prior attempts if any.' where id=q.id; continue;
  end if;
  if q.kind<>'initial' and not exists(select 1 from public.action_email_settings where id and reminders_enabled) then continue; end if;
  if q.first_attempt_at is not null and q.first_attempt_at<now()-interval '23 hours' then
   update public.action_email_queue set status='unknown',last_error='Retry window expired. Reconcile this email in Resend before arranging a new notification.' where id=q.id; continue;
  end if;
  if q.kind='initial' and p.due_date<(now() at time zone 'Asia/Manila')::date then
   update public.action_email_queue set status=case when attempts>0 then 'unknown' else 'failed' end,last_error='Deadline passed before confirmed initial sending. Review and reapprove a revised deadline.' where id=q.id; continue;
  end if;
  if q.kind<>'initial' then
   if (q.kind='before_due' and (now() at time zone 'Asia/Manila')::date>=p.due_date)
    or (q.kind='due_today' and (now() at time zone 'Asia/Manila')::date<>p.due_date)
    or (q.kind='overdue' and (now() at time zone 'Asia/Manila')::date<=p.due_date) then
    update public.action_email_queue set status=case when attempts>0 then 'unknown' else 'cancelled' end,last_error='Reminder stage expired. Reconcile prior attempts if any.' where id=q.id; continue;
   end if;
   if (now() at time zone 'Asia/Manila')::time<time '09:00' then continue; end if;
  end if;
  update public.action_email_queue set status='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '2 minutes',lock_token=gen_random_uuid()
   where id=q.id returning * into q;
  return next q; return;
 end loop;
end; $$;
create function public.finish_action_email(p_id uuid,p_lock_token uuid,p_provider_id text,p_error text,p_retryable boolean)
returns text language plpgsql security definer set search_path='' as $$
declare q public.action_email_queue;
begin
 select * into q from public.action_email_queue where id=p_id for update;
 if not found or q.status<>'sending' or q.lock_token is distinct from p_lock_token then raise exception 'Email lease is no longer current'; end if;
 if p_provider_id is not null and length(p_provider_id)>0 then
  update public.action_email_queue set status='accepted',provider_id=p_provider_id,accepted_at=now(),last_error=null,lease_until=null where id=q.id;
  return 'accepted';
 elsif p_retryable and q.attempts<5 and q.first_attempt_at>now()-interval '23 hours' then
  update public.action_email_queue set status='queued',next_attempt_at=now()+make_interval(mins=>5*q.attempts),last_error=left(p_error,500),lease_until=null where id=q.id;
  return 'queued';
 else
  update public.action_email_queue set status=case when p_retryable then 'unknown' else 'failed' end,last_error=left(p_error,500),lease_until=null where id=q.id;
  return case when p_retryable then 'unknown' else 'failed' end;
 end if;
end; $$;

revoke all on function devicecare_private.valid_email(text),devicecare_private.require_admin(),devicecare_private.draft_failed_inspection(),devicecare_private.compose_action_email(public.device_action_plans,text) from public,anon,authenticated;
revoke all on function public.save_action_email_settings(integer,boolean,boolean,text,text,text,text,text),public.save_device_action_plan(uuid,integer,text,text,text,date),public.preview_device_action_email(uuid),public.approve_device_action_plan(uuid,integer,integer),public.change_device_action_status(uuid,integer,text,text,uuid) from public,anon;
grant execute on function public.save_action_email_settings(integer,boolean,boolean,text,text,text,text,text),public.save_device_action_plan(uuid,integer,text,text,text,date),public.preview_device_action_email(uuid),public.approve_device_action_plan(uuid,integer,integer),public.change_device_action_status(uuid,integer,text,text,uuid) to authenticated;
revoke all on function public.enqueue_action_reminders(),public.claim_action_email(uuid),public.finish_action_email(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_action_reminders(),public.claim_action_email(uuid),public.finish_action_email(uuid,uuid,text,text,boolean) to service_role;
commit;
