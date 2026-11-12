-- HighCall VA ATS: candidate emails (templates, send log, "email needed" tracking).
-- Additive only. Touches ats_ objects only; DeviceCare is not changed.
-- Emails are sent by the ats-send-email Edge Function (server side, via Resend).
begin;

------------------------------------------------------------
-- 1. When did the candidate enter their current stage?
------------------------------------------------------------
alter table public.ats_pipeline add column if not exists stage_changed_at timestamptz;
update public.ats_pipeline p set stage_changed_at = coalesce(
  (select max(e.created_at) from public.ats_pipeline_events e where e.pipeline_id = p.id), p.updated_at, p.created_at)
where stage_changed_at is null;

create or replace function ats_private.stamp_stage_change() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op = 'INSERT' or new.stage is distinct from old.stage then new.stage_changed_at := clock_timestamp(); end if;
 return new;
end;
$$;
revoke all on function ats_private.stamp_stage_change() from public, anon, authenticated;
drop trigger if exists ats_pipeline_stage_stamp on public.ats_pipeline;
create trigger ats_pipeline_stage_stamp before insert or update of stage on public.ats_pipeline
 for each row execute function ats_private.stamp_stage_change();

------------------------------------------------------------
-- 2. Templates recruiters can create and edit
------------------------------------------------------------
create table public.ats_email_templates (
 id         uuid primary key default gen_random_uuid(),
 name       text not null check (length(trim(name)) between 1 and 120),
 purpose    text not null default 'Other' check (purpose in ('Shortlisted','Screening','Interview','Offer','Hired','Rejected','Other')),
 subject    text not null check (length(trim(subject)) between 1 and 200),
 body       text not null check (length(trim(body)) between 1 and 20000),
 created_by uuid default auth.uid() references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create trigger ats_email_templates_touch before update on public.ats_email_templates for each row execute function ats_private.touch_updated_at();
alter table public.ats_email_templates enable row level security;
revoke all on public.ats_email_templates from public, anon, authenticated;
grant select, insert, update, delete on public.ats_email_templates to authenticated;
grant all on public.ats_email_templates to service_role;
create policy ats_email_templates_recruiters on public.ats_email_templates for all to authenticated
 using (public.ats_is_recruiter()) with check (public.ats_is_recruiter());

insert into public.ats_email_templates(name, purpose, subject, body, created_by) values
('Shortlisted', 'Shortlisted', 'Good news about your {{role}} application',
'Hi {{first_name}},

Thank you for applying for the {{role}} role at HighCall VA. We’ve reviewed your application and we’re happy to let you know you’ve been shortlisted.

Our team will contact you soon about the next step.

Best regards,
{{recruiter_name}}
HighCall VA Recruitment', null),
('Screening call', 'Screening', 'Next step: a short screening call for {{role}}',
'Hi {{first_name}},

We’d like to invite you to a short screening call for the {{role}} role.

Date and time: [add date and time, Manila time]
Meeting link: [add link]

During the call we’ll also do a quick check of your computer, internet speed and backup setup, so please join from the place you’ll be working.

Best regards,
{{recruiter_name}}
HighCall VA Recruitment', null),
('Interview invitation', 'Interview', 'Interview invitation: {{role}} at HighCall VA',
'Hi {{first_name}},

Congratulations, you’ve moved to the interview stage for the {{role}} role.

Date and time: [add date and time, Manila time]
Meeting link: [add link]
Who you’ll meet: [add names]

Please reply to confirm you can make it.

Best regards,
{{recruiter_name}}
HighCall VA Recruitment', null),
('Job offer', 'Offer', 'Your offer for the {{role}} role at HighCall VA',
'Hi {{first_name}},

We’re delighted to offer you the {{role}} role at HighCall VA.

[Add offer details: start date, schedule, compensation and next steps]

Please reply to accept by [add deadline]. We’d be glad to answer any questions.

Best regards,
{{recruiter_name}}
HighCall VA Recruitment', null),
('Welcome aboard', 'Hired', 'Welcome to HighCall VA, {{first_name}}',
'Hi {{first_name}},

Welcome to HighCall VA. We’re excited to have you join us as {{role}}.

Our team will be in touch with your onboarding details and device setup check before your first day.

Best regards,
{{recruiter_name}}
HighCall VA Recruitment', null),
('Not selected', 'Rejected', 'Update on your application for {{role}}',
'Hi {{first_name}},

Thank you for your interest in the {{role}} role at HighCall VA and for the time you spent on the process.

After careful review, we’ve decided not to move forward with your application for this role. We’ll keep your profile in our talent pool and may contact you about future roles that fit your experience.

We wish you all the best.

Kind regards,
{{recruiter_name}}
HighCall VA Recruitment', null);

------------------------------------------------------------
-- 3. Email log (written only by the Edge Function or the mark-as-emailed RPC)
------------------------------------------------------------
create table public.ats_emails (
 id           uuid primary key default gen_random_uuid(),
 candidate_id uuid references public.ats_candidates(id) on delete cascade,
 pipeline_id  uuid references public.ats_pipeline(id) on delete set null,
 role_id      uuid references public.ats_roles(id) on delete set null,
 stage        text,
 template_id  uuid references public.ats_email_templates(id) on delete set null,
 to_email     text not null default '',
 subject      text not null default '',
 body_text    text not null default '',
 status       text not null check (status in ('sending','sent','failed','manual')),
 provider_id  text,
 error        text,
 sent_by      uuid references auth.users(id) on delete set null,
 created_at   timestamptz not null default now()
);
create index ats_emails_pipeline_idx on public.ats_emails(pipeline_id, created_at desc);
create index ats_emails_candidate_idx on public.ats_emails(candidate_id, created_at desc);
create index ats_emails_created_idx on public.ats_emails(created_at);
alter table public.ats_emails enable row level security;
revoke all on public.ats_emails from public, anon, authenticated;
grant select on public.ats_emails to authenticated;
grant all on public.ats_emails to service_role;
create policy ats_emails_read on public.ats_emails for select to authenticated using (public.ats_is_recruiter());

-- For candidates told some other way (phone call, personal email): clears "Email needed" without sending.
create function public.ats_mark_emailed(p_pipeline_id uuid, p_note text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare p public.ats_pipeline;
begin
 if auth.uid() is null or not public.ats_is_recruiter() then
  raise exception 'Recruiter access required' using errcode = '42501';
 end if;
 select * into p from public.ats_pipeline where id = p_pipeline_id;
 if not found then raise exception 'Pipeline entry not found'; end if;
 insert into public.ats_emails(candidate_id, pipeline_id, role_id, stage, to_email, subject, body_text, status, sent_by)
 values (p.candidate_id, p.id, p.role_id, p.stage,
  coalesce((select email from public.ats_candidates where id = p.candidate_id), ''),
  'Marked as emailed', left(coalesce(trim(p_note), ''), 2000), 'manual', auth.uid());
end;
$$;
revoke all on function public.ats_mark_emailed(uuid, text) from public, anon;
grant execute on function public.ats_mark_emailed(uuid, text) to authenticated;

------------------------------------------------------------
-- 4. Sender settings (not public)
------------------------------------------------------------
insert into public.ats_settings(key, value, is_public) values
 ('email_branding', jsonb_build_object(
   'from_name', 'HighCall VA Careers',
   'from_email', '',
   'reply_to', '',
   'footer', 'HighCall Virtual Assistants · Remote careers'), false)
on conflict (key) do nothing;

commit;
