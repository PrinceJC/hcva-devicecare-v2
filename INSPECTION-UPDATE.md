# DeviceCare: inspection notes, internet setup and speed screenshots

This patch updates DeviceCare only. It adds one migration to your shared HCVA Supabase project. It does not replace any ATS migration, function, secret, or policy. Existing inspection records, six-month scheduling, incidents and reviewed email action plans remain supported. No dependencies have been added.

## New fields and behavior

- Every inspection check has its own notes field. Notes are optional for pass/not applicable and required for each failed check.
- Device registration/editing includes main internet provider, backup internet and backup power. Enter “None” if no backup is available.
- The inspection form starts with the device's saved internet/backup details. Saving an inspection freezes those details in history and updates the device's current setup.
- Internet speed evidence accepts one PNG, JPG or WebP screenshot per inspection, up to 5 MB. Capture download/upload speed and ping. Crop unrelated/personal/patient information from screenshots.
- Inspection history shows the per-check notes, recorded internet/backup setup, and screenshot. Later edits to the device do not rewrite the historical snapshot.
- Existing older reports still show their original results and findings; additional evidence is shown as not recorded. Historical attachments cannot be silently added or changed.
- Failed-check notes are included in the recorded findings used by the existing action-plan draft. No email is sent just by saving an inspection; the existing review/approval flow still applies.

## 1. Copy files into your existing DeviceCare folder

Extract the ZIP. Copy its contents into the DeviceCare project folder containing package.json. Merge the src, tests and supabase folders; replace the matching source files. Do not delete or replace entire existing folders. Keep all your older migrations, .env.local, .git and local Supabase link metadata.

Files in this patch:

- src/lib/maintenance.js
- src/lib/inspectionEvidence.js (new)
- src/components/DeviceInventory.jsx
- src/components/InspectionForm.jsx
- src/components/InspectionHistory.jsx
- src/components/InspectionEvidence.jsx (new)
- supabase/migrations/20261118000100_inspection_notes_and_connectivity.sql (new)
- tests/inspection-evidence.test.mjs (new)
- tests/ui/inspection-evidence.test.jsx (new)
- this guide

Your existing App.jsx, styles.css, favicon and branding are not part of this patch.

## 2. Apply the migration BEFORE deploying the frontend

In the VS Code PowerShell terminal, in the existing DeviceCare folder:

```powershell
npx.cmd supabase link --project-ref skeyghmyvfsfeqvsjdyl
npx.cmd supabase db push
```

If already linked to HCVA, you can skip the link command. Confirm the pending migration is **20261118000100_inspection_notes_and_connectivity.sql**. If unrelated migrations are pending, or the CLI reports remote versions missing from the local folder, stop and share that message before making changes to the shared project. Do not reset the database or repair migration history as a workaround.

The migration creates a private bucket named **devicecare-speed-evidence**, its access policies, the details table, device connectivity columns and the authenticated completion RPC. You do not need to manually make a public bucket or deploy an Edge Function.

## 3. Run local checks

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run build
npm.cmd run dev
```

Check on your own screen:

1. Open Device inventory → edit/register a device and enter its ISP, backup internet and backup power.
2. Start an inspection. Confirm the connection fields show the saved setup.
3. Add a note to any check. Failed checks require a specific note.
4. Attach a cropped speed-test screenshot and complete the inspection.
5. Open Inspection history → View report. Confirm notes, internet snapshot and image appear.
6. If a screenshot link has expired, click **Refresh evidence link**. Links expire after five minutes.
7. A failed inspection should create the usual action-plan draft with the failed-check notes. Do not approve test emails to real recipients.

Screenshots and extra inspection details are visible to DeviceCare admins, not ordinary VA users or ATS recruiters. The files are not public. Only unattached/orphan uploads may be deleted through the app's storage policy; completed evidence is retained. An interrupted upload or abandoned failed save can leave an unlinked file; an IT admin may remove such unused uploads from this bucket later. Do not remove linked evidence or edit storage metadata directly.

If the connection drops during save, retry the unchanged form: the same request ID and uploaded screenshot are retained in the open form. Check history before changing/recreating a submission after an uncertain save. The pending form is not persisted across closing/reloading the page.

## 4. Publish the updated frontend

After the migration succeeds and local checks pass, stop Vite with Ctrl+C and run:

```powershell
git add src/lib/maintenance.js src/lib/inspectionEvidence.js src/components/DeviceInventory.jsx src/components/InspectionForm.jsx src/components/InspectionHistory.jsx src/components/InspectionEvidence.jsx supabase/migrations/20261118000100_inspection_notes_and_connectivity.sql tests/inspection-evidence.test.mjs tests/ui/inspection-evidence.test.jsx INSPECTION-UPDATE.md
git commit -m "Add inspection notes and private internet speed evidence"
git push
```

Wait for your DeviceCare Vercel deployment to be Ready, then refresh the website. No Vercel environment-variable, Resend or email-function change is required.

## Verification and scope

The complete local suite passed: **39 backend tests and 16 interface/API tests**, plus the production build. The database tests apply all ten known migrations together, using an embedded PostgreSQL-compatible engine with test Auth/Storage scaffolding. They check permissions, required notes, atomic saves, immutable snapshots, safe retries, screenshot references, six-month scheduling and follow-up notes. The hosted Storage upload service and live UI still need the smoke check above after the migration is applied; no production database changes, live uploads or emails were performed during development.
