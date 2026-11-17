-- Corrections retain original values and screenshot references. No existing records are deleted.
begin;
alter table public.inspections add column correction_version integer not null default 1, add column corrected_at timestamptz;
alter table public.device_action_plans add column inspection_review_required boolean not null default false;
create table public.devicecare_inspection_corrections (
 id uuid primary key,
 inspection_id uuid not null references public.inspections(id),
 actor_id uuid not null references auth.users(id),
 actor_email text not null,
 reason text not null,
 submitted_payload jsonb not null,
 before_inspection jsonb not null,
 after_inspection jsonb not null,
 before_details jsonb,
 after_details jsonb not null,
 before_plans jsonb not null,
 created_at timestamptz not null default now()
);
create index devicecare_corrections_inspection on public.devicecare_inspection_corrections(inspection_id,created_at,id);
alter table public.devicecare_inspection_corrections enable row level security;
revoke all on public.devicecare_inspection_corrections from public,anon,authenticated;
grant select on public.devicecare_inspection_corrections to authenticated;
create policy devicecare_corrections_admin_read on public.devicecare_inspection_corrections for select to authenticated using(public.devicecare_is_admin());

-- Protect screenshots from both the current report and its correction history.
drop policy devicecare_speed_orphan_delete on storage.objects;
create policy devicecare_speed_orphan_delete on storage.objects for delete to authenticated
 using(bucket_id='devicecare-speed-evidence' and public.devicecare_is_admin()
 and not exists(select 1 from public.devicecare_inspection_details d where d.speed_screenshot_path=name)
 and not exists(select 1 from public.devicecare_inspection_corrections c
  where c.before_details->>'speed_screenshot_path'=name or c.after_details->>'speed_screenshot_path'=name));

create function devicecare_private.guard_corrected_plan() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.inspection_review_required and new.status in ('awaiting_action','completed') and new.status is distinct from old.status then
  raise exception 'Review the corrected inspection before approving or completing this plan';
 end if;
 return new;
end; $$;
revoke all on function devicecare_private.guard_corrected_plan() from public,anon,authenticated;
create trigger devicecare_corrected_plan_guard before update on public.device_action_plans
 for each row execute function devicecare_private.guard_corrected_plan();

-- Read the report and its details together so the edit form uses one consistent revision.
create function public.devicecare_inspection_for_correction(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb;
begin
 perform devicecare_private.require_admin();
 select jsonb_build_object('inspection',to_jsonb(i),'details',case when d.inspection_id is null then null else to_jsonb(d) end)
 into snapshot from public.inspections i left join public.devicecare_inspection_details d on d.inspection_id=i.id where i.id=p_id;
 if not found then raise exception 'Inspection not found'; end if;
 return snapshot;
end; $$;
revoke all on function public.devicecare_inspection_for_correction(uuid) from public,anon;
grant execute on function public.devicecare_inspection_for_correction(uuid) to authenticated;

create function public.correct_device_inspection(
 p_request_id uuid,p_inspection_id uuid,p_expected_version integer,p_reason text,
 p_results jsonb,p_check_notes jsonb,p_summary text,p_internet_provider text,p_backup_internet text,p_backup_power text,
 p_speed_screenshot_path text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 before_i public.inspections; after_i public.inspections;
 before_d public.devicecare_inspection_details; after_d public.devicecare_inspection_details;
 prior public.devicecare_inspection_corrections;
 notes jsonb; snapshot jsonb; submitted jsonb; before_p jsonb; linked public.device_action_plans;
 provider text; net text; power text; summary text; reason text; screenshot text;
 failed boolean; fail_notes text; v_failed_checks text; v_findings text; device uuid;
begin
 perform devicecare_private.require_admin();
 if p_request_id is null or p_inspection_id is null then raise exception 'Correction and inspection IDs are required'; end if;
 select device_id into device from public.inspections where id=p_inspection_id;
 if not found then raise exception 'Inspection not found'; end if;
 perform 1 from public.devices where id=device for update;
 select * into before_i from public.inspections where id=p_inspection_id for update;
 select * into before_d from public.devicecare_inspection_details where inspection_id=p_inspection_id;
 reason:=trim(coalesce(p_reason,''));summary:=trim(coalesce(p_summary,''));
 provider:=trim(coalesce(p_internet_provider,''));net:=trim(coalesce(p_backup_internet,''));power:=trim(coalesce(p_backup_power,''));
 screenshot:=nullif(trim(coalesce(p_speed_screenshot_path,'')),'');notes:=coalesce(p_check_notes,'{}'::jsonb);
 if length(reason)<5 or length(reason)>2000 then raise exception 'Enter a correction reason between 5 and 2000 characters'; end if;
 if length(summary)>10000 or length(provider)>300 or length(net)>500 or length(power)>500 then raise exception 'Inspection text is too long'; end if;
 if jsonb_typeof(notes)<>'object' then raise exception 'Check notes must be a JSON object'; end if;
 if exists(select 1 from jsonb_each(notes) x where jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>4000 or not(before_i.results ? x.key))
 then raise exception 'Use the original checklist codes and notes up to 4000 characters'; end if;
 select coalesce(jsonb_object_agg(key,trim(value)),'{}'::jsonb) into notes from jsonb_each_text(notes) where length(trim(value))>0;
 submitted:=jsonb_build_object('inspection_id',p_inspection_id,'version',p_expected_version,'reason',reason,'results',p_results,'notes',notes,'summary',summary,'provider',provider,'net',net,'power',power,'screenshot',screenshot);
 select * into prior from public.devicecare_inspection_corrections where id=p_request_id;
 if found then
  if prior.inspection_id<>p_inspection_id or prior.submitted_payload<>submitted then raise exception 'Correction ID already used for different changes'; end if;
  return jsonb_build_object('inspection',to_jsonb(before_i),'saved',true);
 end if;
 if before_i.correction_version is distinct from p_expected_version then raise exception 'This inspection was changed by someone else. Reload it before correcting'; end if;
 if p_results is null or jsonb_typeof(p_results)<>'object' then raise exception 'Results must be a JSON object'; end if;
 if (select count(*) from jsonb_object_keys(p_results))<>(select count(*) from jsonb_object_keys(before_i.results))
  or exists(select 1 from jsonb_each(before_i.results) c where not(p_results ? c.key) or jsonb_typeof(p_results->c.key)<>'string' or p_results->>c.key not in ('pass','fail','na'))
 then raise exception 'Provide a valid result for every original checklist item'; end if;
 if not exists(select 1 from jsonb_each_text(p_results) x where x.value<>'na') then raise exception 'At least one check must be applicable'; end if;
 if exists(select 1 from jsonb_each_text(p_results) x where x.value='fail' and length(coalesce(notes->>x.key,''))=0) then raise exception 'Add a note for each failed check'; end if;
 if screenshot is distinct from before_d.speed_screenshot_path and screenshot is not null then
  if screenshot !~ ('^'||auth.uid()::text||'/'||p_inspection_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$')
   or not exists(select 1 from storage.objects o where o.bucket_id='devicecare-speed-evidence' and o.name=screenshot)
  then raise exception 'Upload the replacement screenshot for this inspection before saving'; end if;
 end if;
 select jsonb_object_agg(c.key,c.value||jsonb_build_object('result',p_results->>c.key)) into snapshot from jsonb_each(before_i.results) c;
 select bool_or(value='fail') into failed from jsonb_each_text(p_results);
 select string_agg((c.value->>'title')||': '||(notes->>c.key),E'\n' order by c.key),
  string_agg(c.value->>'title',E'\n' order by c.key) into fail_notes,v_failed_checks
 from jsonb_each(before_i.results) c where p_results->>c.key='fail';
 v_findings:=concat_ws(E'\n\n',nullif(summary,''),case when fail_notes is not null then E'Failed check notes:\n'||fail_notes end);
 if snapshot=before_i.results and v_findings=before_i.findings and notes=coalesce(before_d.check_notes,'{}'::jsonb)
  and provider=coalesce(before_d.internet_provider,'') and net=coalesce(before_d.backup_internet,'') and power=coalesce(before_d.backup_power,'')
  and screenshot is not distinct from before_d.speed_screenshot_path and summary=coalesce(before_d.summary,before_i.findings)
 then raise exception 'No changes to save'; end if;
 -- Pause original plans and plans that used this inspection as a passing recheck.
 before_p:='[]'::jsonb;
 for linked in select * from public.device_action_plans where inspection_id=p_inspection_id or recheck_inspection_id=p_inspection_id order by id for update loop
  if exists(select 1 from public.action_email_queue where plan_id=linked.id and status='sending' and lease_until>now())
  then raise exception 'An email is currently being sent. Retry the correction in a few minutes'; end if;
  before_p:=before_p||jsonb_build_array(to_jsonb(linked));
  update public.action_email_queue set status=case when attempts>0 then 'unknown' else 'cancelled' end,
   last_error=case when attempts>0 then 'Inspection corrected after an email attempt. Reconcile the provider outcome before arranging another email.' else 'Inspection corrected; IT review required before a new email.' end
   where plan_id=linked.id and status in ('queued','sending');
  update public.device_action_plans set inspection_review_required=true,
   status=case when status in ('awaiting_action','submitted_for_recheck') then 'draft' else status end,
   findings=case when inspection_id=p_inspection_id then v_findings else device_action_plans.findings end,
   failed_checks=case when inspection_id=p_inspection_id then coalesce(v_failed_checks,'No failed checks after correction') else device_action_plans.failed_checks end,
   version=version+1,updated_at=now() where id=linked.id;
  insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(linked.id,'inspection_corrected',auth.uid(),'Inspection corrected; review required. '||reason);
 end loop;
 update public.inspections set results=snapshot,findings=v_findings,has_failures=failed,correction_version=correction_version+1,corrected_at=now()
 where id=p_inspection_id returning * into after_i;
 insert into public.devicecare_inspection_details(inspection_id,check_notes,internet_provider,backup_internet,backup_power,summary,speed_screenshot_path)
 values(p_inspection_id,notes,provider,net,power,summary,screenshot)
 on conflict(inspection_id) do update set check_notes=excluded.check_notes,internet_provider=excluded.internet_provider,backup_internet=excluded.backup_internet,
  backup_power=excluded.backup_power,summary=excluded.summary,speed_screenshot_path=excluded.speed_screenshot_path
 returning * into after_d;
 if failed and not exists(select 1 from public.device_action_plans where inspection_id=p_inspection_id) then
  insert into public.device_action_plans(inspection_id,person_id,device_id,person_name,device_name,findings,failed_checks,recipient_email)
  values(after_i.id,after_i.person_id,after_i.device_id,after_i.person_name_snapshot,after_i.device_model_snapshot,after_i.findings,v_failed_checks,
   coalesce((select email from public.va_people where id=after_i.person_id),'')) returning * into linked;
  insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(linked.id,'created',auth.uid(),'Draft created from corrected inspection. '||reason);
 end if;
 update public.devices d set needs_attention=coalesce((select i.has_failures and not exists(select 1 from public.issue_resolutions r where r.device_id=i.device_id and r.created_at>coalesce(i.corrected_at,i.created_at)) from public.inspections i where i.device_id=d.id order by i.inspected_on desc,i.created_at desc,i.id desc limit 1),false)
  or exists(select 1 from public.device_action_plans p where p.device_id=d.id and p.inspection_review_required)
 where d.id=device;
 insert into public.devicecare_inspection_corrections(id,inspection_id,actor_id,actor_email,reason,submitted_payload,before_inspection,after_inspection,before_details,after_details,before_plans)
 values(p_request_id,p_inspection_id,auth.uid(),coalesce((select email from auth.users where id=auth.uid()),'IT administrator'),reason,submitted,to_jsonb(before_i),to_jsonb(after_i),
  case when before_d.inspection_id is null then null else to_jsonb(before_d) end,to_jsonb(after_d),before_p);
 return jsonb_build_object('inspection',to_jsonb(after_i),'saved',true);
end; $$;
revoke all on function public.correct_device_inspection(uuid,uuid,integer,text,jsonb,jsonb,text,text,text,text,text) from public,anon;
grant execute on function public.correct_device_inspection(uuid,uuid,integer,text,jsonb,jsonb,text,text,text,text,text) to authenticated;

create function public.review_corrected_inspection_plan(p_id uuid,p_expected_version integer,p_resolution text,p_note text)
returns public.device_action_plans language plpgsql security definer set search_path='' as $$
declare p public.device_action_plans; source public.inspections; device uuid;
begin
 perform devicecare_private.require_admin();
 if length(trim(coalesce(p_note,'')))<5 or length(p_note)>2000 then raise exception 'Enter a review note between 5 and 2000 characters'; end if;
 select device_id into device from public.device_action_plans where id=p_id;
 perform 1 from public.devices where id=device for update;
 select * into p from public.device_action_plans where id=p_id for update;
 if not found or not p.inspection_review_required then raise exception 'This plan does not require correction review'; end if;
 if p.version is distinct from p_expected_version then raise exception 'This plan changed. Reload before reviewing'; end if;
 select * into source from public.inspections where id=p.inspection_id;
 if p_resolution='draft' then
  if not source.has_failures then raise exception 'This inspection has no failed checks. Cancel the obsolete plan'; end if;
 elsif p_resolution='retain' then
  if p.status='completed' then
   if not source.has_failures or not exists(select 1 from public.inspections where id=p.recheck_inspection_id and not has_failures) then
    raise exception 'The completed plan no longer has a valid failed inspection and passing recheck'; end if;
  elsif p.status<>'cancelled' then raise exception 'Only a valid completed or cancelled plan can retain its status'; end if;
 elsif p_resolution<>'cancel' or p_resolution is null then raise exception 'Choose draft, cancel or retain'; end if;
 update public.device_action_plans set inspection_review_required=false,
  status=case p_resolution when 'draft' then 'draft' when 'cancel' then 'cancelled' else status end,
  completed_at=case when p_resolution='retain' then completed_at else null end,
  recheck_inspection_id=case when p_resolution='retain' then recheck_inspection_id else null end,
  version=version+1,updated_at=now() where id=p_id returning * into p;
 insert into public.action_plan_events(plan_id,event_type,actor_id,note) values(p_id,'correction_reviewed',auth.uid(),p_resolution||': '||trim(p_note));
 update public.devices d set needs_attention=coalesce((select i.has_failures and not exists(select 1 from public.issue_resolutions r where r.device_id=i.device_id and r.created_at>coalesce(i.corrected_at,i.created_at)) from public.inspections i where i.device_id=d.id order by i.inspected_on desc,i.created_at desc,i.id desc limit 1),false)
  or exists(select 1 from public.device_action_plans a where a.device_id=d.id and a.inspection_review_required) where d.id=device;
 return p;
end; $$;
revoke all on function public.review_corrected_inspection_plan(uuid,integer,text,text) from public,anon;
grant execute on function public.review_corrected_inspection_plan(uuid,integer,text,text) to authenticated;
commit;
