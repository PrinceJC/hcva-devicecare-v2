import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Full fresh database and reviewed action-email workflow", async (t) => {
  const db = new PGlite();
  const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const admin = uid(1),
    va = uid(2),
    person = uid(3),
    device = uid(4);
  const query = (sql, args = []) => db.query(sql, args);
  const as = async (id, role = "authenticated") => {
    await db.exec("reset role");
    await query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    await db.exec(`set role ${role}`);
  };
  let plan, settings;
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    await query(
      "insert into auth.users values($1,'admin@example.com'),($2,'va@example.com')",
      [admin, va],
    );
    await query("insert into devicecare_private.admins values($1)", [admin]);
    await query(
      "insert into public.va_people(id,auth_user_id,full_name,email) values($1,$2,'Sample VA','va@example.com')",
      [person, va],
    );
    await query(
      "insert into public.devices(id,person_id,model) values($1,$2,'Sample laptop')",
      [device, person],
    );
    const checks = (
      await query("select code from public.maintenance_checks")
    ).rows.map((r) => r.code);
    const results = Object.fromEntries(
      checks.map((c) => [c, c === "battery" ? "fail" : "pass"]),
    );
    const today = (
      await query("select (now() at time zone 'Asia/Manila')::date::text today")
    ).rows[0].today;
    await as(admin);
    await t.test(
      "failed inspection creates exactly one draft and keeps six-month scheduling",
      async () => {
        await query(
          "select * from public.complete_inspection($1,$2,$3,$4,$5)",
          [
            uid(10),
            device,
            today,
            JSON.stringify(results),
            "Backup power is unreliable.",
          ],
        );
        plan = (await query("select * from public.device_action_plans"))
          .rows[0];
        assert.equal(plan.status, "draft");
        assert.ok(plan.failed_checks.includes("Battery"));
        assert.equal(
          (await query("select * from public.action_email_queue")).rows.length,
          0,
        );
        await query(
          "select * from public.complete_inspection($1,$2,$3,$4,$5)",
          [
            uid(10),
            device,
            today,
            JSON.stringify(results),
            "Backup power is unreliable.",
          ],
        );
        assert.equal(
          (await query("select * from public.device_action_plans")).rows.length,
          1,
        );
        const dates = (
          await query(
            "select next_due_date=(last_inspected_on+interval '6 months')::date correct from public.devices",
          )
        ).rows[0];
        assert.equal(dates.correct, true);
      },
    );
    await t.test(
      "normal VA cannot read plans, change settings, queue mail, or claim jobs",
      async () => {
        await as(va);
        assert.equal(
          (await query("select * from public.device_action_plans")).rows.length,
          0,
        );
        await assert.rejects(
          query("select public.preview_device_action_email($1)", [plan.id]),
        );
        await assert.rejects(query("select public.claim_action_email(null)"));
        await assert.rejects(
          query("update public.action_email_settings set email_enabled=true"),
        );
        await as(admin);
      },
    );
    await t.test(
      "saved actions and email settings validate addresses and deadlines",
      async () => {
        await assert.rejects(
          query(
            "select * from public.save_device_action_plan($1,1,'Power remediation','Arrange backup power','bad address',current_date+7)",
            [plan.id],
          ),
        );
        plan = (
          await query(
            "select * from public.save_device_action_plan($1,1,'Power remediation','Arrange a suitable backup power supply and request a recheck.','va@example.com',current_date+7)",
            [plan.id],
          )
        ).rows[0];
        await assert.rejects(
          query("select public.preview_device_action_email($1)", [plan.id]),
        );
        settings = (
          await query(
            "select * from public.save_action_email_settings(1,true,true,'it@example.com','it@example.com','ceo@example.com','coo@example.com','hr@example.com')",
          )
        ).rows[0];
      },
    );
    await t.test(
      "preview contains the exact VA, leadership CC, actions and deadline",
      async () => {
        const p = (
          await query("select public.preview_device_action_email($1) preview", [
            plan.id,
          ])
        ).rows[0].preview;
        assert.deepEqual(p.payload.to, ["va@example.com"]);
        assert.deepEqual(p.payload.cc, [
          "ceo@example.com",
          "coo@example.com",
          "hr@example.com",
        ]);
        assert.ok(p.payload.text.includes("backup power supply"));
        assert.ok(p.payload.text.includes("Manila time"));
        await assert.rejects(
          query("select * from public.approve_device_action_plan($1,$2,999)", [
            plan.id,
            plan.version,
          ]),
        );
        plan = (
          await query(
            "select * from public.approve_device_action_plan($1,$2,$3)",
            [plan.id, plan.version, settings.version],
          )
        ).rows[0];
        const queued = (await query("select * from public.action_email_queue"))
          .rows[0];
        assert.deepEqual(queued.payload, p.payload);
        await assert.rejects(
          query("select * from public.approve_device_action_plan($1,$2,$3)", [
            plan.id,
            plan.version,
            settings.version,
          ]),
        );
        assert.equal(
          (await query("select * from public.action_email_queue")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "worker claims one job, excludes concurrent claims and records provider acceptance",
      async () => {
        await as(null, "service_role");
        let q = (await query("select * from public.claim_action_email(null)"))
          .rows[0];
        assert.ok(q.lock_token);
        assert.equal(
          (await query("select * from public.claim_action_email(null)")).rows
            .length,
          0,
        );
        await assert.rejects(
          query("select public.finish_action_email($1,$2,$3,null,false)", [
            q.id,
            uid(999),
            "provider-1",
          ]),
        );
        await query("select public.finish_action_email($1,$2,$3,null,false)", [
          q.id,
          q.lock_token,
          "provider-1",
        ]);
        await as(admin);
        assert.equal(
          (await query("select status from public.action_email_queue")).rows[0]
            .status,
          "accepted",
        );
      },
    );
    await t.test(
      "review transition cancels pending mail and completion requires a passing recheck",
      async () => {
        await assert.rejects(
          query(
            "select * from public.change_device_action_status($1,$2,'completed','Verified',null)",
            [plan.id, plan.version],
          ),
        );
        plan = (
          await query(
            "select * from public.change_device_action_status($1,$2,'submitted_for_recheck','VA reported that backup power was installed.',null)",
            [plan.id, plan.version],
          )
        ).rows[0];
        await query(
          "select * from public.complete_inspection($1,$2,$3,$4,$5)",
          [
            uid(11),
            device,
            today,
            JSON.stringify(Object.fromEntries(checks.map((c) => [c, "pass"]))),
            "Recheck verified backup power.",
          ],
        );
        plan = (
          await query(
            "select * from public.change_device_action_status($1,$2,'completed','IT passing recheck verified.', $3)",
            [plan.id, plan.version, uid(11)],
          )
        ).rows[0];
        assert.equal(plan.status, "completed");
        assert.ok(plan.completed_at);
      },
    );
    await t.test(
      "reminders queue once, retain approved recipients, and skip completed plans",
      async () => {
        // Trusted test fixture creates another eligible approved plan from a fresh failure.
        await query(
          "select * from public.complete_inspection($1,$2,$3,$4,$5)",
          [uid(12), device, today, JSON.stringify(results), "Another issue."],
        );
        let p = (
          await query(
            "select * from public.device_action_plans where inspection_id=$1",
            [uid(12)],
          )
        ).rows[0];
        p = (
          await query(
            "select * from public.save_device_action_plan($1,$2,'Backup power','Install backup power.','va@example.com',current_date+3)",
            [p.id, p.version],
          )
        ).rows[0];
        p = (
          await query(
            "select * from public.approve_device_action_plan($1,$2,$3)",
            [p.id, p.version, settings.version],
          )
        ).rows[0];
        await as(null, "service_role");
        const q = (await query("select * from public.claim_action_email(null)"))
          .rows[0];
        await query(
          "select public.finish_action_email($1,$2,'provider-2',null,false)",
          [q.id, q.lock_token],
        );
        // Set overdue date as the trusted database owner; fixed transaction time avoids clock-sensitive tests.
        await db.exec("reset role");
        await query(
          "update public.device_action_plans set due_date=(now() at time zone 'Asia/Manila')::date-1 where id=$1",
          [p.id],
        );
        // The function's 09:00 Manila gate is deliberately bypassed in a test-only definition when running overnight.
        const def = (
          await query(
            "select pg_get_functiondef('public.enqueue_action_reminders()'::regprocedure) def",
          )
        ).rows[0].def;
        await db.exec(
          def.replace(
            " or (now() at time zone 'Asia/Manila')::time<time '09:00'",
            "",
          ),
        );
        await query(
          "update public.action_email_settings set ceo_email='changed-ceo@example.com' where id",
        );
        await as(null, "service_role");
        await query("select public.enqueue_action_reminders()");
        await query("select public.enqueue_action_reminders()");
        await as(admin);
        const jobs = (
          await query(
            "select * from public.action_email_queue where kind='overdue'",
          )
        ).rows;
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].plan_id, p.id);
        assert.deepEqual(jobs[0].payload.cc, p.approved_payload.cc);
      },
    );
    await t.test(
      "revising a plan cancels an unattempted email and reapproval uses a new revision",
      async () => {
        await query(
          "select * from public.complete_inspection($1,$2,$3,$4,$5)",
          [
            uid(13),
            device,
            today,
            JSON.stringify(results),
            "Upgrade needs review.",
          ],
        );
        let p = (
          await query(
            "select * from public.device_action_plans where inspection_id=$1",
            [uid(13)],
          )
        ).rows[0];
        p = (
          await query(
            "select * from public.save_device_action_plan($1,$2,'Equipment action','Arrange equipment upgrade.','va@example.com',current_date+5)",
            [p.id, p.version],
          )
        ).rows[0];
        const sv = (
          await query("select version from public.action_email_settings")
        ).rows[0].version;
        p = (
          await query(
            "select * from public.approve_device_action_plan($1,$2,$3)",
            [p.id, p.version, sv],
          )
        ).rows[0];
        p = (
          await query(
            "select * from public.change_device_action_status($1,$2,'draft','IT is revising the requirement.',null)",
            [p.id, p.version],
          )
        ).rows[0];
        assert.equal(
          (
            await query(
              "select status from public.action_email_queue where plan_id=$1",
              [p.id],
            )
          ).rows[0].status,
          "cancelled",
        );
        p = (
          await query(
            "select * from public.approve_device_action_plan($1,$2,$3)",
            [p.id, p.version, sv],
          )
        ).rows[0];
        assert.equal(p.revision, 2);
        const rows = (
          await query(
            "select * from public.action_email_queue where plan_id=$1 order by revision",
            [p.id],
          )
        ).rows;
        assert.equal(rows.length, 2);
        assert.equal(rows[1].status, "queued");
        await query(
          "select * from public.change_device_action_status($1,$2,'cancelled','Test plan cancelled.',null)",
          [p.id, p.version],
        );
      },
    );
    await t.test(
      "expired ambiguous sends stop automatically instead of duplicating after provider retry window",
      async () => {
        await db.exec("reset role");
        await query(
          "update public.action_email_queue set status='sending',first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' where kind='overdue'",
        );
        await as(null, "service_role");
        assert.equal(
          (await query("select * from public.claim_action_email(null)")).rows
            .length,
          0,
        );
        await as(admin);
        assert.equal(
          (
            await query(
              "select status from public.action_email_queue where kind='overdue'",
            )
          ).rows[0].status,
          "unknown",
        );
      },
    );
  } finally {
    await db.close();
  }
});
