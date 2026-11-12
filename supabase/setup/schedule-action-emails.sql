-- Run in the NEW project's SQL Editor after deploying the Edge Function.
-- Add secrets using Supabase Vault first (instructions in DEPLOYMENT.md):
-- devicecare_project_url = https://YOUR_NEW_PROJECT.supabase.co
-- devicecare_cron_secret = EXACT SAME value as the Edge Function DEVICECARE_CRON_SECRET
-- Do not commit actual secrets to this file.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='devicecare_project_url')
  or not exists(select 1 from vault.decrypted_secrets where name='devicecare_cron_secret')
 then raise exception 'Create devicecare_project_url and devicecare_cron_secret in Vault first'; end if;
 perform cron.unschedule(jobid) from cron.job where jobname='devicecare-action-email-worker';
end; $$;
select cron.schedule('devicecare-action-email-worker','0 * * * *',
 $job$select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='devicecare_project_url')||'/functions/v1/process-action-emails',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='devicecare_cron_secret')),
 body:='{}'::jsonb,timeout_milliseconds:=10000
 );$job$);
