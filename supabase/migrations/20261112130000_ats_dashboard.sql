-- HighCall VA ATS: Shortlisted stage, stage history and the hiring dashboard.
-- Additive only. Touches ats_ objects only; DeviceCare is not changed.
begin;

------------------------------------------------------------
-- 1. Add the Shortlisted stage (between Applied and Screening)
------------------------------------------------------------
alter table public.ats_pipeline drop constraint if exists ats_pipeline_stage_check;
alter table public.ats_pipeline add constraint ats_pipeline_stage_check
 check (stage is null or stage in ('Sourced','Applied','Shortlisted','Screening','Interview','Offer','Hired','Rejected'));

------------------------------------------------------------
-- 2. Stage history: one row every time a candidate enters a stage.
-- No foreign keys on purpose: monthly counts stay correct even after
-- a candidate is deleted for privacy (no personal data is stored here).
------------------------------------------------------------
create table public.ats_pipeline_events (
 id          uuid primary key default gen_random_uuid(),
 pipeline_id uuid not null,
 candidate_id uuid not null,
 role_id     uuid,
 from_stage  text,
 to_stage    text not null,
 actor_id    uuid,            -- null = the candidate applied themselves
 created_at  timestamptz not null default now()
);
create index ats_pipeline_events_stage_time_idx on public.ats_pipeline_events(to_stage, created_at);
create index ats_pipeline_events_pipeline_idx on public.ats_pipeline_events(pipeline_id, created_at);
create index ats_pipeline_events_actor_idx on public.ats_pipeline_events(actor_id, created_at);
create index ats_pipeline_created_idx on public.ats_pipeline(created_at);
create index ats_candidates_created_idx on public.ats_candidates(created_at);

alter table public.ats_pipeline_events enable row level security;
revoke all on public.ats_pipeline_events from public, anon, authenticated;
grant select on public.ats_pipeline_events to authenticated;
create policy ats_pipeline_events_read on public.ats_pipeline_events for select to authenticated using (public.ats_is_recruiter());

create function ats_private.log_stage_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.stage is not null and (tg_op = 'INSERT' or new.stage is distinct from old.stage) then
  insert into public.ats_pipeline_events(pipeline_id, candidate_id, role_id, from_stage, to_stage, actor_id)
  values (new.id, new.candidate_id, new.role_id, case when tg_op = 'UPDATE' then old.stage end, new.stage, auth.uid());
 end if;
 return new;
end;
$$;
revoke all on function ats_private.log_stage_change() from public, anon, authenticated;
create trigger ats_pipeline_stage_log after insert or update of stage on public.ats_pipeline
 for each row execute function ats_private.log_stage_change();

-- Backfill history for anything already in the pipeline (best available timestamps).
insert into public.ats_pipeline_events(pipeline_id, candidate_id, role_id, from_stage, to_stage, actor_id, created_at)
select p.id, p.candidate_id, p.role_id, null, p.stage, null,
       case when p.stage in ('Sourced','Applied') then p.created_at else p.updated_at end
from public.ats_pipeline p where p.stage is not null;

------------------------------------------------------------
-- 3. Dashboard numbers, calculated in Manila time.
-- p_period: this_month | last_month | last_30 | this_year | all
------------------------------------------------------------
create function public.ats_dashboard(p_period text default 'this_month') returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
 tz constant text := 'Asia/Manila';
 order_stages constant text[] := array['Sourced','Applied','Shortlisted','Screening','Interview','Offer','Hired'];
 local_now timestamp := now() at time zone tz;
 v_from timestamptz;
 v_to timestamptz := now();
 result jsonb;
begin
 if auth.uid() is null or not public.ats_is_recruiter() then
  raise exception 'Recruiter access required' using errcode = '42501';
 end if;
 case coalesce(p_period, 'this_month')
  when 'this_month' then v_from := date_trunc('month', local_now) at time zone tz;
  when 'last_month' then v_from := (date_trunc('month', local_now) - interval '1 month') at time zone tz;
                         v_to   := date_trunc('month', local_now) at time zone tz;
  when 'last_30'    then v_from := now() - interval '30 days';
  when 'this_year'  then v_from := date_trunc('year', local_now) at time zone tz;
  when 'all'        then v_from := '-infinity'::timestamptz;
  else raise exception 'Unknown period' using errcode = '22023';
 end case;

 with
 -- first time each pipeline reached each stage-or-beyond (for a funnel that never double counts)
 reach as (
  select e.pipeline_id, s.stage, min(e.created_at) as first_at
  from public.ats_pipeline_events e
  cross join unnest(order_stages) with ordinality as s(stage, pos)
  where array_position(order_stages, e.to_stage) >= s.pos
  group by e.pipeline_id, s.stage
 ),
 -- hires that still stand: the latest stage recorded for that pipeline is Hired
 -- (history only, so counts survive candidate deletion)
 hired as (
  select r.pipeline_id, r.first_at, h.actor_id, h.role_id
  from reach r
  cross join lateral (select e.actor_id, e.role_id from public.ats_pipeline_events e
     where e.pipeline_id = r.pipeline_id and e.to_stage = 'Hired' order by e.created_at limit 1) h
  where r.stage = 'Hired'
    and (select e.to_stage from public.ats_pipeline_events e where e.pipeline_id = r.pipeline_id
         order by e.created_at desc, e.id desc limit 1) = 'Hired'
 ),
 shortlist as (
  select r.pipeline_id, r.first_at, (select e.actor_id from public.ats_pipeline_events e
     where e.pipeline_id = r.pipeline_id and array_position(order_stages, e.to_stage) >= 3 order by e.created_at limit 1) as actor_id
  from reach r where r.stage = 'Shortlisted'
 )
 select jsonb_build_object(
  'period', coalesce(p_period, 'this_month'),
  'from', case when v_from = '-infinity'::timestamptz then null else v_from end,
  'to', v_to,
  'applied', (select count(*) from public.ats_pipeline where source = 'applied' and role_id is not null and created_at >= v_from and created_at < v_to),
  'pool_joined', (select count(*) from public.ats_candidates where source = 'self' and created_at >= v_from and created_at < v_to),
  'recruiter_added', (select count(*) from public.ats_candidates where source = 'recruiter' and created_at >= v_from and created_at < v_to),
  'copied_to_roles', (select count(*) from public.ats_pipeline where source = 'sourced' and created_at >= v_from and created_at < v_to),
  'entered', (select count(*) from public.ats_pipeline where role_id is not null and created_at >= v_from and created_at < v_to),
  'shortlisted', (select count(*) from shortlist where first_at >= v_from and first_at < v_to),
  'hired', (select count(*) from hired where first_at >= v_from and first_at < v_to),
  'rejected', (select count(distinct pipeline_id) from public.ats_pipeline_events where to_stage = 'Rejected' and created_at >= v_from and created_at < v_to),
  'funnel', (select jsonb_object_agg(s.stage, (select count(*) from reach r where r.stage = s.stage and r.first_at >= v_from and r.first_at < v_to))
             from unnest(array['Shortlisted','Screening','Interview','Offer']) s(stage)),
  'current', (select coalesce(jsonb_object_agg(x.stage, x.n), '{}'::jsonb) from
              (select coalesce(p.stage, 'Applied') as stage, count(*) as n from public.ats_pipeline p
               join public.ats_roles r on r.id = p.role_id where r.status in ('public','internal') group by 1) x),
  'open_roles', (select count(*) from public.ats_roles where status in ('public','internal')),
  'pool_total', (select count(*) from public.ats_candidates),
  'trend', (select jsonb_agg(jsonb_build_object(
              'month', to_char(m, 'YYYY-MM'),
              'applied', (select count(*) from public.ats_pipeline p where p.source = 'applied' and p.role_id is not null
                            and p.created_at >= (m at time zone tz) and p.created_at < ((m + interval '1 month') at time zone tz)),
              'hired', (select count(*) from hired h where h.first_at >= (m at time zone tz) and h.first_at < ((m + interval '1 month') at time zone tz))
            ) order by m)
            from generate_series(date_trunc('month', local_now) - interval '5 months', date_trunc('month', local_now), interval '1 month') m),
  'recruiters', (select coalesce(jsonb_agg(x order by (x->>'hired')::int desc, (x->>'added')::int desc, x->>'name'), '[]'::jsonb) from (
              select jsonb_build_object(
               'user_id', s.user_id, 'name', coalesce(s.name, s.email), 'role', s.role,
               'added', (select count(*) from public.ats_candidates c where c.created_by = s.user_id and c.source = 'recruiter' and c.created_at >= v_from and c.created_at < v_to),
               'copied', (select count(*) from public.ats_pipeline_events e where e.actor_id = s.user_id and e.to_stage = 'Sourced' and e.created_at >= v_from and e.created_at < v_to),
               'shortlisted', (select count(*) from shortlist sl where sl.actor_id = s.user_id and sl.first_at >= v_from and sl.first_at < v_to),
               'hired', (select count(*) from hired h where h.actor_id = s.user_id and h.first_at >= v_from and h.first_at < v_to),
               'last_active', greatest(
                  (select max(e.created_at) from public.ats_pipeline_events e where e.actor_id = s.user_id),
                  (select max(c.created_at) from public.ats_candidates c where c.created_by = s.user_id))
              ) as x
              from public.ats_staff s where s.role in ('admin','recruiter')) t),
  'roles', (select coalesce(jsonb_agg(x order by x->>'status', (x->>'applied')::int desc), '[]'::jsonb) from (
              select jsonb_build_object(
               'id', r.id, 'title', r.title, 'status', r.status,
               'applied', (select count(*) from public.ats_pipeline p where p.role_id = r.id and p.source = 'applied' and p.created_at >= v_from and p.created_at < v_to),
               'active', (select count(*) from public.ats_pipeline p where p.role_id = r.id and coalesce(p.stage, 'Applied') not in ('Hired','Rejected')),
               'waiting', (select count(*) from public.ats_pipeline p where p.role_id = r.id and coalesce(p.stage, 'Applied') = 'Applied'),
               'hired', (select count(*) from hired h where h.role_id = r.id and h.first_at >= v_from and h.first_at < v_to)
              ) as x
              from public.ats_roles r where r.status in ('public','internal')) t)
 ) into result;
 return result;
end;
$$;
revoke all on function public.ats_dashboard(text) from public, anon;
grant execute on function public.ats_dashboard(text) to authenticated;

commit;
