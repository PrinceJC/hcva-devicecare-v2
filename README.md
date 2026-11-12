> Existing shared HCVA deployment: start with **EMAIL-UPDATE.md**. This update contains no new SQL migrations. All uploaded ATS migrations and ATS function files are preserved.

# HCVA DeviceCare 2.0

Complete React + Vite frontend, Supabase database and Auth integration,
Supabase email worker, and deployment instructions for a new Supabase project
and a new Vercel project.

Start with **DEPLOYMENT.md**. Windows commands use `npm.cmd` and `npx.cmd`.

## Included

- HCVA logo, sidebar dashboard, automatic admin-session verification.
- VA/candidate directory, device inventory, six-month maintenance scheduling.
- Maintenance checklist and inspection history.
- Incident logging, troubleshooting notes, resolution and activity history.
- Failed-inspection action plans, IT-reviewed emails, configurable leadership
  CC recipients, deadlines, reminders, escalation and provider acceptance logs.
- All database migrations, tests, server code and example configuration files.

## Action-plan flow

1. IT completes an inspection with a failed checklist item.
2. Supabase creates a **draft action plan** automatically. No email is sent.
3. IT sets the actual required actions, VA email, and deadline.
4. IT previews the exact email, including CEO/COO/HR CC recipients.
5. IT checks the review confirmation and approves the plan. The email is queued
   and the app immediately requests server-side processing.
6. A scheduled worker processes ready jobs hourly even when the app is closed.
7. If enabled, it sends one approaching-deadline reminder, one due-date notice,
   and one overdue escalation, all after 09:00 Manila time.
8. IT records the VA's response and marks the plan Submitted for recheck.
9. IT completes a later passing inspection and links it to close the plan.

VAs do not have a self-service submission screen in this version. They reply
to IT's configured reply-to address; IT records their updates in the app.

## Requirements

- Node.js 24 LTS and npm; Git for source control.
- A new Supabase project and an admin Auth account.
- A Vercel project for the frontend.
- A Resend account, API key and a sender domain you can verify through DNS.
- Real CEO, COO and HR recipient addresses configured by IT inside the app.

## Local commands

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
npm.cmd run dev
```

For local Supabase development, Docker is required for `npx.cmd supabase start`.
The included PostgreSQL tests run through PGlite and do not need Docker or a
live Supabase account. Email tests use a fake provider and send no real mail.

## Email state meanings

- **Queued:** reviewed and approved, awaiting processing.
- **Sending:** held by a worker lease.
- **Accepted by email provider:** Resend returned an acceptance ID. This is not
  proof of inbox delivery, reading, or completion of the VA's required action.
- **Rejected / failed:** provider/configuration failure requiring IT review.
- **Needs manual reconciliation:** the send outcome is uncertain outside the
  safe automatic retry window; inspect Resend before arranging a new notice.
- **Cancelled:** a status/revision change stopped the queued message.

Resend currently retains idempotency keys for 24 hours. The worker uses a stable
key for each frozen queue message and a conservative 23-hour automatic retry
window, with a maximum of five attempts. It never automatically retries an
ambiguous message after that window. Exact-once inbox delivery is not promised.

A submitted/completed/cancelled plan stops reminders. Returning a plan to draft
cancels pending old messages and requires a new preview and approval. Emails
already accepted by the provider cannot be withdrawn. Already-running sends
must finish or have their lease expire before plan status changes proceed.

## Fresh-project scope

The source is based on your GitHub repository at commit
`ab83a8ddeebdacbe1327555dd885e313a4984a16`. The complete app is included.
Your old Supabase users, passwords, device records and incident records are
not embedded in this ZIP. A new project starts with empty operational tables.
Keep the old project available until you have separately migrated any data you
want to retain. Auth user IDs must be mapped carefully during a data migration.

No Resend account has been connected, no email has been sent, and no live
Supabase/Vercel changes have been made by generating this package.

## Official references

- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/functions/auth
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/dashboard/emails/idempotency-keys
