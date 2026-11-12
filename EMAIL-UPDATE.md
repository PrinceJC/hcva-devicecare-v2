# DeviceCare per-VA email update — existing shared HCVA project

This is an update to your supplied DeviceCare code. The separate ATS frontend does not need replacing. All nine supplied migrations, the Supabase config (including ats-send-email), ATS SQL files, and ATS function source are preserved. This update requires **no new database migration**. Do not reset your shared database or change ATS secrets, policies, or migrations.

## What changed

- After saving a failed device evaluation, click **Review and email this VA** to open the exact inspection's action plan.
- Search plans by VA name. Each failed evaluation keeps its own plan and email history.
- Save required improvements, VA email and a Manila deadline, preview the exact sender/To/CC/body, confirm recipients and click **Approve and send to this VA**.
- If already approved but queued, click **Send this VA email** in that plan's email history. It processes only that existing job; it does not approve again or send everyone else's emails.
- Email settings now separates the connection check, sender/leadership settings and sending instructions. There is no browser “send all” action.
- Connection check authenticates an IT admin and reads configuration only: no emails or reminders are queued or sent. A configured provider key still requires a controlled send to validate it and the sender domain.
- More useful errors explain missing function deployment, mismatched origin, authentication failures, provider rejection and retry status.
- DeviceCare-specific server settings coexist with ATS. Legacy names are fallback-compatible.

## 1. Update the existing DeviceCare source

Extract the ZIP. Copy the source files from its `hcva-devicecare-email-update` folder into your existing DeviceCare project folder (the folder containing package.json). Keep your local `.env.local`, `.git`, Supabase `.temp` link metadata and other local configuration. The ZIP contains none of these. Your existing two VITE_SUPABASE variables should continue to point at HCVA.

Main changed files: src/App.jsx, src/lib/actions.js, src/components/InspectionForm.jsx, src/components/DeviceInventory.jsx, src/components/ActionPlans.jsx, src/components/EmailSettings.jsx, src/actions.css, supabase/functions/_shared/email-worker.mjs, supabase/functions/process-action-emails/index.ts, server env example, tests and documentation. No dependencies were changed.

In PowerShell from that folder:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
```

Do not run `supabase db reset`. You do not need `db push` for this email update. Keep all supplied migrations in the repository for the shared project's history.

## 2. Configure DeviceCare server secrets

Open **HCVA project → Edge Functions → Secrets** in Supabase. Add or update only the DeviceCare values below. Do not remove ATS values or replace a shared RESEND_API_KEY used by ATS.

| Name                       | Value                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEVICECARE_APP_ORIGIN      | Your actual DeviceCare Vercel origin, such as https://your-devicecare.vercel.app. Copy the Website origin shown in DeviceCare → Email settings. Use the DeviceCare URL, not the ATS URL. |
| DEVICECARE_RESEND_API_KEY  | A real Resend API key permitted to send from your verified sender domain. You can use the same provider account as ATS, but this variable does not overwrite ATS's configuration.        |
| DEVICECARE_PUBLISHABLE_KEY | Optional explicit publishable key from the HCVA Supabase project; if omitted the worker uses Supabase's built-in SUPABASE_ANON_KEY.                                                      |
| DEVICECARE_SECRET_KEY      | Optional explicit server secret key from HCVA; if omitted the worker uses Supabase's built-in SUPABASE_SERVICE_ROLE_KEY.                                                                 |

If optional explicit keys already exist, confirm they belong to **HCVA**, not the old DeviceCare project. Do not enter placeholder values from the example file. Do not change platform-managed SUPABASE_* values.

These server secrets do **not** go in Vercel or React's VITE_ variables. Leave ATS_APP_ORIGIN, ATS keys, shared RESEND_API_KEY, and ats-send-email unchanged.

The Edge Function normalizes a trailing slash, but each allowed origin is still exact; a preview Vercel hostname is different from your production hostname.

For local development only, optionally add DEVICECARE_ALLOW_LOCALHOST=true. Leave it false for production-only access.

## 3. Deploy just the DeviceCare email function

Run from the updated DeviceCare folder:

```powershell
npx.cmd supabase login
npx.cmd supabase functions deploy process-action-emails --project-ref skeyghmyvfsfeqvsjdyl
```

This targets your **HCVA** project and deploys only **process-action-emails**. It does not deploy or replace **ats-send-email**. The existing config.toml must retain [functions.process-action-emails] with verify_jwt=false; the handler itself validates signed-in users and their DeviceCare admin role, or the scheduler's private secret.

Database push and Vercel deployment do not deploy this Supabase function. The live function endpoint was returning NOT_FOUND when investigated; this deploy step is required.

## 4. Upload the frontend and redeploy Vercel

In the existing DeviceCare repository, after the checks pass:

```powershell
git add src supabase/functions tests README.md DEPLOYMENT.md EMAIL-UPDATE.md supabase/setup/schedule-action-emails.sql
git status --short
git commit -m "Fix DeviceCare email setup and individual VA sending"
git push
```

Review the status before committing; actual environment files must stay ignored. Your Git-connected Vercel project should build the update. Otherwise redeploy that DeviceCare project manually. Keep the existing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for HCVA. Do not deploy the ATS frontend from this folder.

## 5. Check and test one VA's message

1. Sign in to DeviceCare as the IT admin.
2. Open **Email settings → Check email connection**. It sends nothing. Resolve any missing configuration shown.
3. Set the sender to an address on your verified Resend domain, IT reply-to, and CEO/COO/HR CC addresses. Save. Saving does not send.
4. For a controlled send test, use only addresses you control or have designated for that test in **all** recipient fields, including leadership CC; saving test leadership settings affects subsequent new approvals, so coordinate changes on an already-used app and restore real settings after testing. Existing approved messages keep their previously reviewed recipients.
5. Complete a failed test evaluation. Open **Review and email this VA**, save actions and deadline, preview and inspect all recipients, then approve and send.
6. Inspect **Email history**. “Accepted by provider” is not a guarantee of inbox delivery; check Resend logs and the recipient inbox as well.
7. An already approved queued job can use its individual send button. If it was accepted, do not approve a new revision merely to resend. Jobs with ambiguous outcomes need reconciliation in Resend before a new notification.

If provider rejection is recorded, correct the cause first. The app intentionally does not blindly retry permanent or ambiguous failures. After verifying in Resend that no message was accepted, use the existing “Return to draft for changes” status with an IT note, save changes, then preview and reapprove only if a new notification is appropriate. This produces a new recorded revision.

## 6. Optional automatic reminders

Manual individual sending works without Cron. For automatic retries/reminders, set **DEVICECARE_CRON_SECRET** in function secrets to a random 64-character value. If you already have a working DeviceCare schedule using the legacy CRON_SECRET, either keep the old value through the fallback or update its Vault counterpart at the same time.

In Supabase Vault, keep **devicecare_project_url** as https://skeyghmyvfsfeqvsjdyl.supabase.co and **devicecare_cron_secret** equal to the chosen DeviceCare scheduler secret. Install or update only the DeviceCare schedule using supabase/setup/schedule-action-emails.sql, then enable reminders in the app. This schedule can process up to five ready jobs hourly; the individual UI send button always targets just one job. Do not edit ATS cron jobs.

## Validation and boundaries

Backend tests apply all nine supplied migrations together in an embedded PostgreSQL-compatible database, with Auth/Storage test scaffolding. They include a recruiter-only account denied DeviceCare admin access. UI tests cover individual job selection, recipient review, connection check and VA search. Worker tests never contact Resend.

The production frontend build and Deno type check are also run before packaging. A successful local test is not live-provider or hosted-Supabase verification. No production data was changed and no real email was sent during development. Configure and deploy the server function, then perform the controlled send above.
