import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Audited inspection corrections and email review safeguards", async (t) => {
  const db = new PGlite();
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const admin = uid(1),
    va = uid(2),
    recruiter = uid(3),
    person = uid(4),
    device = uid(5),
    request = uid(6);
  const q = (sql, args = []) => db.query(sql, args);
  const as = async (id, role = "authenticated") => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id || ""]);
    await db.exec(`set role ${role}`);
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key,bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to anon,authenticated,service_role;
 grant select,insert,delete,update on storage.objects to authenticated,anon;`);
    const folder = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(folder))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(name, folder), "utf8"));
    await q(
      "insert into auth.users values($1,'admin@example.com'),($2,'va@example.com'),($3,'recruiter@example.com')",
      [admin, va, recruiter],
    );
    await q("insert into devicecare_private.admins values($1)", [admin]);
    await q(
      "insert into public.ats_staff(user_id,email,role) values($1,'recruiter@example.com','recruiter')",
      [recruiter],
    );
    await q(
      "insert into public.va_people(id,auth_user_id,full_name) values($1,$2,'Example VA')",
      [person, va],
    );
    await q(
      "insert into public.devices(id,person_id,model) values($1,$2,'Example laptop')",
      [device, person],
    );
    const checks = (await q("select code from maintenance_checks")).rows;
    const results = Object.fromEntries(checks.map((c) => [c.code, "pass"]));
    results.connectivity = "fail";
    const date = (
      await q("select (now() at time zone 'Asia/Manila')::date::text d")
    ).rows[0].d;
    const path = `${admin}/${request}/${uid(7)}.png`;
    const base = {
      id: request,
      results,
      notes: {
        connectivity: "Upload speed is 2 Mbps; improve connection.",
        hardware: "Casing and ports checked.",
      },
      provider: "PLDT",
      net: "Smart data",
      power: "UPS",
      summary: "Arrange an internet recheck.",
      path,
    };
    const complete = (changes = {}) => {
      const p = { ...base, ...changes };
      return q(
        "select * from public.complete_device_inspection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          p.id,
          device,
          date,
          JSON.stringify(p.results),
          p.summary,
          JSON.stringify(p.notes),
          p.provider,
          p.net,
          p.power,
          p.path,
        ],
      );
    };

    await as(admin);
    await q(
      "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
      [uid(8), path],
    );
    const original = (await complete()).rows[0];
    const plan = (
      await q("select * from device_action_plans where inspection_id=$1", [
        request,
      ])
    ).rows[0];
    // Fixture represents a previously accepted email plus pending reminders.
    await db.exec("reset role");
    await q(
      "update device_action_plans set status='awaiting_action',revision=1,approved_payload=$2 where id=$1",
      [
        plan.id,
        JSON.stringify({
          to: ["va@example.com"],
          text: "Previously approved message",
        }),
      ],
    );
    for (const [n, kind, status, attempts] of [
      [70, "initial", "accepted", 1],
      [71, "before_due", "queued", 0],
      [72, "due_today", "queued", 1],
    ])
      await q(
        "insert into action_email_queue(id,plan_id,revision,kind,payload,status,attempts) values($1,$2,1,$3,$4,$5,$6)",
        [
          uid(n),
          plan.id,
          kind,
          JSON.stringify({ to: ["va@example.com"], text: "Frozen message" }),
          status,
          attempts,
        ],
      );
    await as(admin);
    const newPath = `${admin}/${request}/${uid(22)}.png`;
    await q(
      "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
      [uid(23), newPath],
    );
    const editedNotes = {
      ...base.notes,
      hardware: "Corrected: casing has a cosmetic scratch.",
    };
    const correction = {
      id: uid(20),
      inspection: request,
      version: 1,
      reason: "Correcting the recorded equipment observation.",
      results,
      notes: editedNotes,
      summary: base.summary,
      provider: "Correct ISP",
      net: base.net,
      power: base.power,
      path: newPath,
    };
    const correct = async (changes = {}) => {
      const p = { ...correction, ...changes };
      return (
        await q(
          "select public.correct_device_inspection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) saved",
          [
            p.id,
            p.inspection,
            p.version,
            p.reason,
            JSON.stringify(p.results),
            JSON.stringify(p.notes),
            p.summary,
            p.provider,
            p.net,
            p.power,
            p.path,
          ],
        )
      ).rows[0].saved;
    };
    await t.test(
      "validates reason, every failed-item note and screenshot ownership atomically",
      async () => {
        const snapshot = (
          await q("select public.devicecare_inspection_for_correction($1) s", [
            request,
          ])
        ).rows[0].s;
        assert.equal(snapshot.inspection.correction_version, 1);
        assert.equal(snapshot.details.internet_provider, "PLDT");
        await assert.rejects(correct({ reason: "" }), /correction reason/);
        await assert.rejects(correct({ notes: {} }), /note for each failed/);
        await assert.rejects(
          correct({ path: `${va}/${request}/${uid(22)}.png` }),
          /replacement screenshot/,
        );
        assert.equal(
          (
            await q(
              "select count(*)::int n from devicecare_inspection_corrections",
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await q("select correction_version from inspections where id=$1", [
              request,
            ])
          ).rows[0].correction_version,
          1,
        );
      },
    );
    await t.test(
      "saves revision with immutable originals, author and snapshots while preserving scheduling and current device setup",
      async () => {
        const saved = await correct();
        assert.equal(saved.inspection.correction_version, 2);
        const audit = (
          await q("select * from devicecare_inspection_corrections")
        ).rows[0];
        assert.equal(audit.actor_id, admin);
        assert.equal(audit.actor_email, "admin@example.com");
        assert.equal(audit.before_details.speed_screenshot_path, path);
        assert.equal(audit.after_details.speed_screenshot_path, newPath);
        assert.equal(audit.before_inspection.findings, original.findings);
        assert.equal(audit.before_plans[0].status, "awaiting_action");
        assert.equal(
          saved.inspection.inspected_on,
          original.inspected_on.toISOString().slice(0, 10),
        );
        assert.equal(
          saved.inspection.next_due_date,
          original.next_due_date.toISOString().slice(0, 10),
        );
        assert.equal(
          (
            await q("select internet_provider from devices where id=$1", [
              device,
            ])
          ).rows[0].internet_provider,
          "PLDT",
        );
        await assert.rejects(q("update inspections set findings='Bypass'"));
        await assert.rejects(
          q("delete from devicecare_inspection_corrections"),
        );
      },
    );
    await t.test(
      "pauses pending mail but preserves accepted messages and approved payloads",
      async () => {
        const current = (
          await q("select * from device_action_plans where id=$1", [plan.id])
        ).rows[0];
        assert.equal(current.status, "draft");
        assert.equal(current.inspection_review_required, true);
        assert.equal(
          current.approved_payload.text,
          "Previously approved message",
        );
        const emails = (
          await q(
            "select id,status,payload from action_email_queue order by id",
          )
        ).rows;
        assert.deepEqual(
          emails.map((e) => e.status),
          ["accepted", "cancelled", "unknown"],
        );
        assert.equal(emails[0].payload.text, "Frozen message");
        await q(
          "select public.save_action_email_settings(1,true,false,'it@example.com','it@example.com','ceo@example.com','coo@example.com','hr@example.com')",
        );
        await q(
          "select public.save_device_action_plan($1,$2,'Corrected plan','Arrange the required upgrade','va@example.com',($3::date+7))",
          [plan.id, current.version, date],
        );
        const preview = (
          await q("select public.preview_device_action_email($1) v", [plan.id])
        ).rows[0].v;
        await assert.rejects(
          q("select public.approve_device_action_plan($1,$2,$3)", [
            plan.id,
            preview.plan_version,
            preview.settings_version,
          ]),
          /Review the corrected inspection/,
        );
        assert.equal(
          (await q("select count(*)::int n from action_email_queue")).rows[0].n,
          3,
        );
      },
    );
    await t.test(
      "retries are idempotent and stale or changed correction requests cannot overwrite a revision",
      async () => {
        assert.equal((await correct()).inspection.correction_version, 2);
        await assert.rejects(
          correct({ provider: "Different payload" }),
          /different changes/,
        );
        await assert.rejects(
          correct({ id: uid(24) }),
          /changed by someone else/,
        );
        await assert.rejects(
          correct({ id: uid(24), version: 2 }),
          /No changes/,
        );
        assert.equal(
          (
            await q(
              "select count(*)::int n from devicecare_inspection_corrections",
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "original and replacement screenshots remain protected after correction",
      async () => {
        for (const p of [path, newPath])
          assert.equal(
            (
              await q(
                "delete from storage.objects where name=$1 returning id",
                [p],
              )
            ).rows.length,
            0,
          );
      },
    );
    await t.test(
      "review is explicit, preserves old send history and never creates an email by itself",
      async () => {
        let p = (
          await q("select * from device_action_plans where id=$1", [plan.id])
        ).rows[0];
        await assert.rejects(
          q(
            "select public.review_corrected_inspection_plan($1,$2,'draft','')",
            [p.id, p.version],
          ),
          /review note/,
        );
        await q(
          "select public.review_corrected_inspection_plan($1,$2,'draft','Reviewed the corrected findings and requirements')",
          [p.id, p.version],
        );
        p = (
          await q("select * from device_action_plans where id=$1", [plan.id])
        ).rows[0];
        assert.equal(p.inspection_review_required, false);
        assert.equal(p.status, "draft");
        assert.equal(
          (await q("select count(*)::int n from action_email_queue")).rows[0].n,
          3,
        );
        assert.equal(
          (
            await q("select status from action_email_queue where id=$1", [
              uid(70),
            ])
          ).rows[0].status,
          "accepted",
        );
      },
    );
    await t.test(
      "corrected passing rechecks flag completed plans and cannot silently retain invalid completion",
      async () => {
        const recheck = uid(30),
          passing = Object.fromEntries(checks.map((c) => [c.code, "pass"]));
        await q("select public.complete_inspection($1,$2,$3,$4,'')", [
          recheck,
          device,
          date,
          JSON.stringify(passing),
        ]);
        await db.exec("reset role");
        await q(
          "update device_action_plans set status='completed',completed_at=now(),recheck_inspection_id=$2 where id=$1",
          [plan.id, recheck],
        );
        await as(admin);
        const saved = await correct({
          id: uid(31),
          inspection: recheck,
          version: 1,
          path: null,
          summary: "Recheck entry corrected",
          notes: {
            connectivity: "The recheck did not meet the required speed.",
          },
          provider: "Recheck ISP",
        });
        assert.equal(saved.inspection.has_failures, true);
        let p = (
          await q("select * from device_action_plans where id=$1", [plan.id])
        ).rows[0];
        assert.equal(p.status, "completed");
        assert.equal(p.inspection_review_required, true);
        await assert.rejects(
          q(
            "select public.review_corrected_inspection_plan($1,$2,'retain','Checked the recheck record')",
            [p.id, p.version],
          ),
          /no longer has a valid/,
        );
        assert.equal(
          (
            await q(
              "select count(*)::int n from device_action_plans where inspection_id=$1",
              [recheck],
            )
          ).rows[0].n,
          1,
        );
        await q(
          "select public.review_corrected_inspection_plan($1,$2,'draft','Reopen after discovering the failed recheck')",
          [p.id, p.version],
        );
        p = (
          await q("select * from device_action_plans where id=$1", [plan.id])
        ).rows[0];
        assert.equal(p.status, "draft");
        assert.equal(p.completed_at, null);
      },
    );

    await t.test(
      "passing corrections require cancelling an obsolete failed-inspection plan",
      async () => {
        const passing = Object.fromEntries(checks.map((c) => [c.code, "pass"]));
        await correct({
          id: uid(40),
          inspection: uid(30),
          version: 2,
          results: passing,
          path: null,
          summary: "Confirmed that original pass was correct",
          notes: { hardware: "Confirmed casing condition" },
          provider: "Corrected ISP",
        });
        const p = (
          await q("select * from device_action_plans where inspection_id=$1", [
            uid(30),
          ])
        ).rows[0];
        assert.equal(p.inspection_review_required, true);
        await assert.rejects(
          q(
            "select public.review_corrected_inspection_plan($1,$2,'draft','Reviewed all passing results')",
            [p.id, p.version],
          ),
          /no failed checks/,
        );
        await q(
          "select public.review_corrected_inspection_plan($1,$2,'cancel','All checks pass after the correction')",
          [p.id, p.version],
        );
        assert.equal(
          (
            await q("select status from device_action_plans where id=$1", [
              p.id,
            ])
          ).rows[0].status,
          "cancelled",
        );
      },
    );
    await t.test(
      "removing a current screenshot preserves both earlier images in audit history",
      async () => {
        await correct({ id: uid(41), version: 2, path: null });
        assert.equal(
          (
            await q(
              "select speed_screenshot_path from devicecare_inspection_details where inspection_id=$1",
              [request],
            )
          ).rows[0].speed_screenshot_path,
          null,
        );
        for (const image of [path, newPath])
          assert.equal(
            (
              await q(
                "delete from storage.objects where name=$1 returning id",
                [image],
              )
            ).rows.length,
            0,
          );
      },
    );
    await t.test(
      "cannot correct while an affected email is actively being sent",
      async () => {
        await db.exec("reset role");
        await q(
          "insert into action_email_queue(id,plan_id,revision,kind,payload,status,lease_until) values($1,$2,1,'overdue','{}','sending',now()+interval '1 hour')",
          [uid(80), plan.id],
        );
        await as(admin);
        await assert.rejects(
          correct({
            id: uid(81),
            version: 3,
            summary: "Another correction during send",
          }),
          /currently being sent/,
        );
        assert.equal(
          (
            await q("select correction_version from inspections where id=$1", [
              request,
            ])
          ).rows[0].correction_version,
          3,
        );
      },
    );
    await t.test(
      "VA, anonymous and ATS-only users cannot correct, review plans or read audit values",
      async () => {
        for (const [id, role] of [
          [va, "authenticated"],
          [recruiter, "authenticated"],
          [null, "anon"],
        ]) {
          await as(id, role);
          await assert.rejects(
            q("select public.devicecare_inspection_for_correction($1)", [
              request,
            ]),
          );
          await assert.rejects(correct({ id: uid(90), version: 2 }));
          await assert.rejects(
            q(
              "select public.review_corrected_inspection_plan($1,1,'cancel','Unauthorized review')",
              [plan.id],
            ),
          );
          if (role === "anon")
            await assert.rejects(
              q("select * from devicecare_inspection_corrections"),
            );
          else
            assert.equal(
              (await q("select * from devicecare_inspection_corrections")).rows
                .length,
              0,
            );
        }
      },
    );
  } finally {
    await db.close();
  }
});
