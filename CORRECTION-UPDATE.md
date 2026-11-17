# DeviceCare — edit completed inspections with correction history

This patch builds on the inspection-notes/screenshot update you already deployed. It contains only the changed DeviceCare source, one new migration and tests. It does not replace your ATS files, other migrations, environment files, sidebar, colors or favicon. No new dependencies or Edge Function changes are required.

## What you can correct

Open **Inspection history → View report → Edit inspection**.

You can correct pass/fail/not applicable results, each item's notes, internet provider, backup internet, backup power, the findings summary and the speed-test screenshot. Every failed check needs a note. Enter a meaningful **Reason for correction** and click **Save correction**.

The assigned VA, device, inspection date and next maintenance date remain attached to the original inspection. Editing connection details corrects the historical report only; use Device inventory to change the current device setup. Use a new inspection for a new evaluation.

## How history is preserved

- Existing inspections start at Revision 1. Saving a correction increments the revision.
- The database stores the editor's authenticated account/email, timestamp, reason, submitted changes, complete before/after inspection and detail snapshots, and the previous linked-plan state.
- **Correction history** shows the changed fields side by side and lets you view original/revised screenshots with short-lived links.
- Replacing or removing the current screenshot retains its historical reference. App-level Storage policies protect both current and historical evidence.
- Browser admins can read the audit log but cannot directly overwrite or delete it. Changes are made through the authenticated correction RPC.
- Stale competing saves are rejected. Click **Reload latest inspection (discard edits)** to reload and review another editor's changes.
- Retrying an unchanged correction in the open form reuses its correction ID and uploaded replacement. Pending edits are not retained after closing/reloading the browser.

## What happens to action plans and emails

Saving a correction never sends an email.

Affected plans include the original failed-inspection plan and any plan that used this inspection as its passing recheck. These are flagged **Inspection corrected — IT review required**. Active plans return to draft, pending unattempted messages are cancelled and automatic reminders stop for those plans. A correction is blocked while an email is actively being sent. Ambiguous previous send attempts remain marked for provider reconciliation; already accepted messages and their frozen content stay in email history.

Open each flagged plan in **Action plans** and record a review note. Choose:

- **Prepare a revised draft for failed checks:** available only if the original linked inspection still has failures. Review/edit the requirements, preview the exact email, then explicitly approve if a new notification is appropriate. Reviewing by itself sends nothing.
- **Cancel the obsolete plan:** use when the corrected inspection no longer warrants follow-up. This preserves previous history and sent emails.
- **Keep the existing final status if still valid:** available for completed/cancelled plans. A completed plan must still have a failed source inspection and a passing recheck. An invalid completed plan must be revised or cancelled instead.

A pass-to-fail correction creates the usual new draft if no source plan exists. No initial email is automatically queued.

Check Resend for any **Needs manual reconciliation** message before approving another notification. A correction cannot recall an email already sent; coordinate any explanation required for the VA and leadership.

## 1. Copy the patch into the existing DeviceCare project

Copy the ZIP contents into your existing project folder containing package.json. Merge folders and replace matching files. Keep .env.local, .git, all existing migrations and local Supabase link metadata. Do not delete or replace entire folders.

Changed/new source files:

- src/lib/inspectionCorrections.js
- src/lib/actions.js
- src/components/InspectionCorrection.jsx
- src/components/InspectionCorrectionHistory.jsx
- src/components/InspectionHistory.jsx
- src/components/ActionPlans.jsx

The patch also contains the new migration, regression tests and this guide. The shared-schema test now allows the Outreach template alongside the six original ATS templates; it no longer assumes there can only be six.

## 2. Apply ONE new migration before deploying the interface

From the existing DeviceCare VS Code PowerShell terminal:

```powershell
npx.cmd supabase db push
```

The project should already be linked to HCVA (skeyghmyvfsfeqvsjdyl). The only pending file should be:

```text
20261118000200_inspection_corrections.sql
```

Confirm only that migration. If older ATS or inspection migrations appear, stop and share the list; do not repair history or rerun old scripts without checking. Do not run db reset.

This migration adds columns, an audit table, RPCs and a plan guard. It replaces only the DeviceCare orphan-file deletion policy to protect historical screenshots as well. It does not delete existing VAs, devices, inspections, incidents, action plans, email records or ATS data.

## 3. Test locally

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
npm.cmd run dev
```

Use a test inspection to verify:

1. Edit a note or ISP value, enter a reason and save.
2. The report revision changes and Correction history shows the original and revised values, reason and editor.
3. Replace/remove a screenshot and confirm the old image remains viewable in history.
4. Check Action plans for affected-plan review flags. Review/cancel an obsolete test plan; do not approve real-recipient test emails.
5. A completed plan whose passing recheck was corrected to Fail requires review before it can be retained as completed.

## 4. Publish after the migration and local checks succeed

Stop Vite with Ctrl+C, then:

```powershell
git add src/lib/inspectionCorrections.js src/lib/actions.js src/components/InspectionCorrection.jsx src/components/InspectionCorrectionHistory.jsx src/components/InspectionHistory.jsx src/components/ActionPlans.jsx supabase/migrations/20261118000200_inspection_corrections.sql tests/inspection-corrections.test.mjs tests/actions.test.mjs tests/ui/inspection-corrections.test.jsx tests/ui/actions.test.jsx CORRECTION-UPDATE.md
git commit -m "Add audited inspection corrections and follow-up review"
git push
```

Wait for your DeviceCare Vercel deployment to show Ready, then refresh the app. Supabase secrets, Resend settings and Edge Functions do not need redeploying for this patch.

## Validation

All **51 backend tests**, **22 interface/API tests**, and the configured production build passed locally. The backend suite applies the twelve known migrations in an embedded PostgreSQL-compatible engine with Auth/Storage scaffolding. Tests cover immutable before/after records, required reasons/notes, screenshot preservation, authentication/roles, stale and repeated corrections, email history, pending-send cancellation, completed recheck invalidation and explicit follow-up review.

No live database changes, uploads or emails were made during development. Check the hosted app after deployment using the test workflow above. Automated browser layout verification was not available in this environment.
