# Fresh deployment — Windows / VS Code

This is a complete source package. Use the whole extracted folder for your new
application. Do not copy only a few frontend files into a new empty project.
The existing six-month maintenance and incident features are included.

## 1. Open the new folder and install

Extract `hcva-devicecare-complete.zip`. Open the `hcva-devicecare-complete`
folder in VS Code. It contains package.json, src/, public/, supabase/ and tests/.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
```

If PowerShell blocks npm.ps1, continue using npm.cmd / npx.cmd.

## 2. Create and link a NEW Supabase project

Create the new project in Supabase. Record its Project Reference ID and database
password securely. The existing source includes supabase/config.toml, so you
do not need to run `supabase init` again.

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref YOUR_NEW_PROJECT_REF
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Check that the reference is the NEW project before applying. Run all supplied
migrations, including the original schema, six-month change, incidents, and
action/email migration. Do not paste migrations into SQL Editor as well as
pushing them with the CLI. `db reset` is for disposable local development only.

## 3. Create your new admin account

In the new Supabase project, open Authentication > Users and create an admin
user using your chosen email/password. Auto-confirm it if appropriate for your
internal setup. Copy its new Auth User UID.

In the new project's SQL Editor, run the following with that actual UID:

```sql
insert into devicecare_private.admins(user_id)
values ('YOUR_NEW_AUTH_USER_UID'::uuid)
on conflict do nothing;
```

Do not use your old project's UID. It belongs to a different Auth database.
Do not commit a real password or an edited bootstrap file with account data.
Disable public signup if you intend accounts to be created by IT only.

## 4. Configure and verify your local frontend

Copy root `.env.example` to root `.env.local` and enter values from the NEW
Supabase project's Connect / API Keys settings:

```env
VITE_SUPABASE_URL=https://YOUR_NEW_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_NEW_PUBLIC_KEY
```

These are browser configuration values. Never put a secret/service-role key,
Resend key or Cron secret into a VITE_* variable.

```powershell
npm.cmd run build
npm.cmd run dev
```

Open the Local URL printed by Vite and sign in with the newly created admin.
Add a test VA with an email address you control, register a device, and complete
a failed inspection. Verify a draft appears under Action plans. Email remains
disabled by default.

## 5. Create the NEW GitHub / Vercel deployment

For an isolated new deployment, create a new private GitHub repository such as
`hcva-devicecare-v2`. The ZIP contains no .git directory.

```powershell
git init
git branch -M main
git config user.name "YOUR_COMMIT_NAME"
git config user.email "YOUR_GITHUB_EMAIL"
git add .
git --no-pager diff --cached --name-only
git commit -m "Deploy HCVA DeviceCare with reviewed action emails"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_NEW_REPO.git
git push -u origin main
```

Confirm .env.local, node_modules, dist and function secrets are absent from the
staged file list. Only example environment files with placeholders belong in Git.
You may instead use your existing GitHub repo, but pushing to it can also trigger
its existing Vercel deployment. Plan that separately if keeping the old app live.

Import the new repository in Vercel. Use:

| Setting          | Value           |
| ---------------- | --------------- |
| Framework        | Vite            |
| Root Directory   | Repository root |
| Build Command    | npm run build   |
| Output Directory | dist            |
| Node.js          | 24.x            |

Before deploying, add the NEW project's VITE_SUPABASE_URL and
VITE_SUPABASE_PUBLISHABLE_KEY to Vercel's Production environment. Deploy and
record the final production origin, e.g. `https://your-new-app.vercel.app`.
Changes to Vercel variables require a new deployment. Supabase SQL migrations
and Edge Functions are deployed separately; Vercel does not install them.

In Supabase Auth URL Configuration, set your new Vercel app as Site URL and add
only the local/production redirect URLs you intend to use. Configure Preview
separately if you later deploy preview environments against another database.

## 6. Set up Resend

1. Create a Resend account and API key for sending.
2. Add a sender domain you control and complete its DNS verification.
3. Choose a sender such as `devicecare@your-company-domain.com` within that
   verified domain, plus a monitored IT reply-to mailbox.
4. Check the provider's account limits and sending permissions before rollout.

An arbitrary Gmail/Outlook sender is not a verified company sender. The provider
must permit the selected domain and external recipients. A test-domain account
may restrict recipients; use an address you control for the first test.

No real CEO, COO or HR addresses are supplied in this source. Enter the actual
approved addresses in the application settings after setup.

## 7. Configure server-only function secrets

Copy `supabase/functions/.env.example` to
`supabase/functions/.env.local` and replace every placeholder:

```env
DEVICECARE_RESEND_API_KEY=re_YOUR_RESEND_API_KEY
DEVICECARE_PUBLISHABLE_KEY=sb_publishable_YOUR_NEW_PROJECT_KEY
DEVICECARE_SECRET_KEY=sb_secret_YOUR_NEW_PROJECT_SECRET_KEY
DEVICECARE_APP_ORIGIN=https://your-new-app.vercel.app
DEVICECARE_CRON_SECRET=YOUR_RANDOM_64_CHARACTER_SECRET
DEVICECARE_ALLOW_LOCALHOST=false
```

DEVICECARE_APP_ORIGIN is only the scheme and hostname, with no trailing slash or URL path.
Generate a random Cron secret in the terminal:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it private. Use the same value in the function secrets and Supabase Vault.
The Edge Function can also use Supabase's built-in legacy server credentials,
but the explicit DEVICECARE_* settings above make new-project configuration clear.

Upload the server secrets and deploy the function:

```powershell
npx.cmd supabase secrets set --env-file supabase/functions/.env.local
npx.cmd supabase functions deploy process-action-emails
```

The function has verify_jwt=false in config.toml because it handles both admin
user JWTs and the dedicated Cron secret. Its own handler verifies user identity
with Supabase Auth and checks the admin database role before processing any
queue jobs. Do not remove those handler checks.

For testing from localhost, temporarily set DEVICECARE_ALLOW_LOCALHOST=true in the function
secrets. After testing, set it back to false. Do not point a new preview frontend
at live production records without configuring its origin and data access.

## 8. Enable the hourly worker

In the NEW project's Dashboard, open Vault (under database/integrations tools,
depending on the current dashboard layout) and create these two secrets:

| Vault secret name      | Value                                        |
| ---------------------- | -------------------------------------------- |
| devicecare_project_url | https://YOUR_NEW_PROJECT_REF.supabase.co     |
| devicecare_cron_secret | EXACT SAME value as the function DEVICECARE_CRON_SECRET |

You can also create them in a PRIVATE SQL Editor query using
`select vault.create_secret('VALUE', 'NAME');`. Do not commit the completed
query with secret values. Use one matching secret per name; update it rather
than creating duplicate named entries.

Run `supabase/setup/schedule-action-emails.sql` in the new project's SQL Editor.
It enables pg_cron/pg_net if available and installs the hourly job. Run it after
the Edge Function is deployed. The script replaces its existing named job on
reruns so it does not create duplicate schedules.

Verify the scheduler:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'devicecare-action-email-worker';
```

Use Cron job history, `net._http_response`, and Edge Function logs to diagnose
scheduled processing failures. A successful pg_net submission is not evidence
that an email was accepted; check the app's email history as well.

A paused/unavailable Supabase project cannot run its Cron jobs. After downtime,
the worker queues the current appropriate reminder stage instead of sending
all missed historical stages at once.

## 9. Configure addresses and perform one controlled send

In the new app, open Email settings. Enter:

- Your verified sender email.
- Your monitored IT reply-to email.
- CEO, COO and HR email addresses for CC.

For a controlled test, use mailboxes you own or have explicitly designated for
testing. Review all recipient fields carefully before enabling email sending.
Enable email and save. Keep automatic reminders off until the first test works.

Open a draft action plan from a failed test inspection:

1. Set a specific action, correct recipient, and deadline; save the draft.
2. Click Preview email and recipients.
3. Check the exact From, To, CC, subject, body, required actions and deadline.
4. Tick the review confirmation and click Approve and queue email.
5. Inspect Email history. A returned provider ID means accepted by the provider.
6. Confirm receipt directly in the test mailbox or provider dashboard.

If the immediate request fails, the approval remains saved and the job stays
queued for the scheduler. Email settings also has Process queued emails now.
No new manual duplicate email is required just because the browser timed out.

Turn automatic reminders on after the controlled test and schedule verification.
Approaching-deadline notices are generated within three days before the date;
a due-date notice is generated on the date and one overdue escalation after it.
The worker runs hourly, sends stages after 09:00 Manila time, skips expired
queued reminder stages, and does not send
reminders while a plan is Submitted for recheck, Completed or Cancelled.

## 10. Complete the action and verify records

Record the VA's reply by changing the plan to Submitted for recheck with an IT
note. Complete a later passing device inspection. In the action plan, choose
Completed, select that passing recheck, add the IT verification note, and save.

To edit an approved plan, return it to draft with an explanatory note. This
cancels unsent messages at the old revision. Save the changes and reapprove a
new preview. An email already accepted by Resend cannot be unsent.

Do not automatically resend a job marked Needs manual reconciliation. Check
its provider history first. The UI intentionally does not claim final delivery
or force an uncertain duplicate.

## Troubleshooting

- **Failed to fetch at login:** verify the new URL/key, project health, browser
  connectivity and Vercel environment variables. Supabase must be running.
- **Missing tables/functions:** push all migrations to the intended project.
- **Function 401/403:** verify the signed-in account's admin row, the configured
  DEVICECARE_APP_ORIGIN, and the function's publishable/server keys from the SAME project.
- **Queue does not process:** verify function deployment, DEVICECARE_RESEND_API_KEY,
  matching Cron secrets, email enabled setting, Cron history and function logs.
- **Provider rejects sender:** verify the Resend sending domain and account.
- **Unknown outcome:** reconcile against the provider; do not blindly resend.
- **Settings/plan changed:** reload, review current data, then preview again.
- **Completion rejected:** choose a later passing inspection on the same device.

## Existing data

This is a fresh-project deployment guide. Existing live user accounts and data
are not copied automatically. Keep the old project intact while you decide
whether to migrate it. User UUIDs, device relationships, and administrator
membership must be mapped during a separate migration; do not paste an old
Auth UID into the new project.

If an initial email has not been confirmed sent before its deadline passes,
the worker stops it for review instead of imposing an already-expired deadline
on the VA. Revise the plan, set a reasonable new date, preview and reapprove.
