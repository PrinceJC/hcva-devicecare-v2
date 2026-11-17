import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Detailed inspection snapshots and private speed evidence on the shared HCVA schema", async (t) => {
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
    await t.test(
      "requires notes for failed checks and rejects unuploaded screenshots atomically",
      async () => {
        await assert.rejects(complete({ notes: {} }), /note for each failed/);
        await assert.rejects(complete(), /Upload the screenshot/);
        assert.equal(
          (await q("select count(*)::int n from inspections")).rows[0].n,
          0,
        );
        await assert.rejects(
          complete({ path: null, notes: { unknown: "Invalid" } }),
          /checklist codes/,
        );
      },
    );
    await t.test(
      "stores item notes, network snapshot, screenshot and follow-up in one transaction",
      async () => {
        await q(
          "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
          [uid(8), path],
        );
        const saved = (await complete()).rows[0];
        assert.equal(saved.id, request);
        const details = (await q("select * from devicecare_inspection_details"))
          .rows[0];
        assert.equal(details.check_notes.hardware, "Casing and ports checked.");
        assert.equal(details.speed_screenshot_path, path);
        assert.equal(details.internet_provider, "PLDT");
        assert.equal(
          (await q("select internet_provider from devices")).rows[0]
            .internet_provider,
          "PLDT",
        );
        assert.ok(
          (
            await q("select findings from device_action_plans")
          ).rows[0].findings.includes("Upload speed is 2 Mbps"),
        );
        const due = (
          await q(
            "select ((($1::date + interval '6 months')::date)=next_due_date) ok from inspections",
            [date],
          )
        ).rows[0];
        assert.equal(due.ok, true);
      },
    );
    await t.test(
      "unchanged retries reuse a record; changed evidence cannot overwrite history",
      async () => {
        assert.equal((await complete()).rows[0].id, request);
        await assert.rejects(
          complete({ provider: "Another ISP" }),
          /different inspection details/,
        );
        await assert.rejects(
          complete({ summary: "Changed" }),
          /different inspection details/,
        );
        await assert.rejects(
          q(
            "update devicecare_inspection_details set internet_provider='Other'",
          ),
        );
        assert.equal(
          (await q("select count(*)::int n from inspections")).rows[0].n,
          1,
        );
        await q("update devices set internet_provider='Later ISP'");
        assert.equal(
          (
            await q(
              "select internet_provider from devicecare_inspection_details",
            )
          ).rows[0].internet_provider,
          "PLDT",
        );
      },
    );
    await t.test(
      "completed screenshot is protected while an orphan upload can be removed",
      async () => {
        assert.equal(
          (
            await q("delete from storage.objects where name=$1 returning id", [
              path,
            ])
          ).rows.length,
          0,
        );
        const orphan = `${admin}/${uid(9)}/${uid(10)}.jpg`;
        await q(
          "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
          [uid(11), orphan],
        );
        assert.equal(
          (
            await q("delete from storage.objects where name=$1 returning id", [
              orphan,
            ])
          ).rows.length,
          1,
        );
        await assert.rejects(
          q(
            "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
            [uid(12), `${va}/${uid(9)}/${uid(10)}.png`],
          ),
        );
      },
    );
    await t.test(
      "VA, ATS recruiter and anonymous access cannot read or upload IT evidence",
      async () => {
        for (const [id, role] of [
          [va, "authenticated"],
          [recruiter, "authenticated"],
          [null, "anon"],
        ]) {
          await as(id, role);
          if (role === "authenticated")
            assert.equal(
              (await q("select * from devicecare_inspection_details")).rows
                .length,
              0,
            );
          else
            await assert.rejects(
              q("select * from devicecare_inspection_details"),
            );
          assert.equal(
            (
              await q(
                "select * from storage.objects where bucket_id='devicecare-speed-evidence'",
              )
            ).rows.length,
            0,
          );
          await assert.rejects(complete());
          await assert.rejects(
            q(
              "insert into storage.objects values($1,'devicecare-speed-evidence',$2)",
              [uid(99), `${id}/${uid(90)}/${uid(91)}.png`],
            ),
          );
        }
      },
    );
  } finally {
    await db.close();
  }
});
