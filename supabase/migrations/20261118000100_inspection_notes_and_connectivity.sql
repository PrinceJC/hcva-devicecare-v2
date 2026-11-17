-- Additive DeviceCare update; ATS and existing inspection/email functions stay intact.
begin;
alter table public.devices
 add column internet_provider text not null default '' check(length(internet_provider)<=300),
 add column backup_internet text not null default '' check(length(backup_internet)<=500),
 add column backup_power text not null default '' check(length(backup_power)<=500);
grant insert(internet_provider,backup_internet,backup_power),update(internet_provider,backup_internet,backup_power) on public.devices to authenticated;

create table public.devicecare_inspection_details (
 inspection_id uuid primary key references public.inspections(id),
 check_notes jsonb not null default '{}'::jsonb,
 internet_provider text not null,
 backup_internet text not null,
 backup_power text not null,
 summary text not null default '',
 speed_screenshot_path text unique,
 created_at timestamptz not null default now()
);
alter table public.devicecare_inspection_details enable row level security;
revoke all on public.devicecare_inspection_details from public,anon,authenticated;
grant select on public.devicecare_inspection_details to authenticated;
create policy devicecare_details_admin_read on public.devicecare_inspection_details for select to authenticated using(public.devicecare_is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('devicecare-speed-evidence','devicecare-speed-evidence',false,5242880,array['image/png','image/jpeg','image/webp']);
create policy devicecare_speed_admin_read on storage.objects for select to authenticated
 using(bucket_id='devicecare-speed-evidence' and public.devicecare_is_admin());
create policy devicecare_speed_admin_upload on storage.objects for insert to authenticated
 with check(bucket_id='devicecare-speed-evidence' and public.devicecare_is_admin()
 and (storage.foldername(name))[1]=auth.uid()::text
 and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$');
-- Completed evidence is immutable. Only unlinked uploads may be deleted.
create policy devicecare_speed_orphan_delete on storage.objects for delete to authenticated
 using(bucket_id='devicecare-speed-evidence' and public.devicecare_is_admin()
 and not exists(select 1 from public.devicecare_inspection_details d where d.speed_screenshot_path=name));

create function public.complete_device_inspection(
 p_request_id uuid,p_device_id uuid,p_inspected_on date,p_results jsonb,p_findings text,
 p_check_notes jsonb,p_internet_provider text,p_backup_internet text,p_backup_power text,
 p_speed_screenshot_path text default null
) returns public.inspections
language plpgsql security definer set search_path='' as $$
declare
 saved public.inspections; old_details public.devicecare_inspection_details;
 notes jsonb; provider text; backup_net text; power text; summary text; screenshot text;
 combined_findings text; failure_notes text;
begin
 if auth.uid() is null or not public.devicecare_is_admin() then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 -- Same lock order as complete_inspection, including retries.
 perform 1 from public.devices where id=p_device_id for update;
 if not found then raise exception 'Device not found'; end if;
 notes:=coalesce(p_check_notes,'{}'::jsonb);
 if jsonb_typeof(notes)<>'object' then raise exception 'Check notes must be a JSON object'; end if;
 if exists(select 1 from jsonb_each(notes) x where jsonb_typeof(x.value)<>'string'
  or length(x.value#>>'{}')>4000 or not exists(select 1 from public.maintenance_checks c where c.code=x.key))
 then raise exception 'Use checklist codes and notes up to 4000 characters'; end if;
 select coalesce(jsonb_object_agg(key,trim(value)), '{}'::jsonb) into notes
 from jsonb_each_text(notes) where length(trim(value))>0;
 if p_results is null or jsonb_typeof(p_results)<>'object' then raise exception 'Results must be a JSON object'; end if;
 if exists(select 1 from jsonb_each_text(p_results) x where x.value='fail' and length(coalesce(notes->>x.key,''))=0)
 then raise exception 'Add a note for each failed check'; end if;
 provider:=trim(coalesce(p_internet_provider,'')); backup_net:=trim(coalesce(p_backup_internet,''));
 power:=trim(coalesce(p_backup_power,'')); summary:=trim(coalesce(p_findings,''));
 screenshot:=nullif(trim(coalesce(p_speed_screenshot_path,'')),'');
 if length(provider)>300 or length(backup_net)>500 or length(power)>500 or length(summary)>10000
 then raise exception 'Internet, backup or findings text is too long'; end if;
 if screenshot is not null and (screenshot !~ ('^'||auth.uid()::text||'/'||p_request_id::text||'/[0-9a-f-]{36}\.(png|jpg|webp)$')
  or not exists(select 1 from storage.objects o where o.bucket_id='devicecare-speed-evidence' and o.name=screenshot))
 then raise exception 'Upload the screenshot for this inspection before saving'; end if;
 select * into old_details from public.devicecare_inspection_details where inspection_id=p_request_id;
 if found then
  if old_details.check_notes is distinct from notes or old_details.internet_provider<>provider
   or old_details.backup_internet<>backup_net or old_details.backup_power<>power
   or old_details.summary<>summary or old_details.speed_screenshot_path is distinct from screenshot
  then raise exception 'Request ID already used for different inspection details'; end if;
 elsif exists(select 1 from public.inspections where id=p_request_id) then
  raise exception 'Existing inspections cannot be overwritten with new details';
 end if;
 select string_agg(c.title||': '||(notes->>c.code),E'\n' order by c.sort_order) into failure_notes
 from public.maintenance_checks c where p_results->>c.code='fail';
 combined_findings:=concat_ws(E'\n\n',nullif(summary,''),case when failure_notes is not null then E'Failed check notes:\n'||failure_notes end);
 select * into saved from public.complete_inspection(p_request_id,p_device_id,p_inspected_on,p_results,combined_findings);
 if old_details.inspection_id is not null then return saved; end if;
 insert into public.devicecare_inspection_details(inspection_id,check_notes,internet_provider,backup_internet,backup_power,summary,speed_screenshot_path)
 values(saved.id,notes,provider,backup_net,power,summary,screenshot);
 update public.devices set internet_provider=provider,backup_internet=backup_net,backup_power=power where id=p_device_id;
 return saved;
end; $$;
revoke all on function public.complete_device_inspection(uuid,uuid,date,jsonb,text,jsonb,text,text,text,text) from public,anon;
grant execute on function public.complete_device_inspection(uuid,uuid,date,jsonb,text,jsonb,text,text,text,text) to authenticated;
commit;
