import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Uses real PostgreSQL through PGlite; Supabase Auth/JWT context is stubbed.
test("DeviceCare incidents: permissions, logging, history and safe updates", async (t) => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const admin = id(1),
    va = id(2),
    other = id(3),
    person = id(4),
    device = id(5),
    otherPerson = id(6),
    otherDevice = id(7),
    incident = id(10);
  const query = (sql, params = []) => db.query(sql, params);
  const asUser = async (user) => {
    await db.exec("reset role");
    await query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec("set role authenticated");
  };
  const create = (request = incident, overrides = {}) => {
    const v = {
      person,
      title: "Laptop shuts down",
      description: "Reported shutdown during calls.",
      category: "hardware",
      priority: "high",
      device,
      label: "",
      reported: "2026-10-20T17:00:00Z",
      ...overrides,
    };
    return query(
      "select * from public.create_device_incident($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        request,
        v.person,
        v.title,
        v.description,
        v.category,
        v.priority,
        v.device,
        v.label,
        v.reported,
      ],
    );
  };
  const update = (request, version, overrides = {}) => {
    const v = {
      incident,
      status: "in_progress",
      priority: "high",
      note: "Checked power adapter.",
      resolution: "",
      ...overrides,
    };
    return query(
      "select * from public.record_incident_update($1,$2,$3,$4,$5,$6,$7)",
      [
        request,
        v.incident,
        version,
        v.status,
        v.priority,
        v.note,
        v.resolution,
      ],
    );
  };
  const current = async () =>
    (
      await query("select * from public.device_incidents where id=$1", [
        incident,
      ])
    ).rows[0];
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261021000100_devicecare.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261022000100_device_incidents.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await query(
      "insert into auth.users values($1,'admin@example.com'),($2,'va@example.com'),($3,'other@example.com')",
      [admin, va, other],
    );
    await query("insert into devicecare_private.admins values($1)", [admin]);
    await query(
      "insert into public.va_people(id,auth_user_id,full_name) values($1,$2,'Sample VA'),($3,$4,'Other VA')",
      [person, va, otherPerson, other],
    );
    await query(
      "insert into public.devices(id,person_id,model,asset_tag) values($1,$2,'Lenovo ThinkPad','ASSET-1'),($3,$4,'Dell laptop','ASSET-2')",
      [device, person, otherDevice, otherPerson],
    );
    await asUser(admin);

    await t.test(
      "rejects invalid details, future reports and device-owner mismatches",
      async () => {
        await assert.rejects(create(id(20), { title: " " }));
        await assert.rejects(create(id(21), { description: "" }));
        await assert.rejects(create(id(22), { device: otherDevice }));
        await assert.rejects(create(id(23), { priority: "invalid" }));
        await assert.rejects(
          create(id(24), { reported: "2999-01-01T00:00:00Z" }),
        );
        assert.equal(
          (await query("select * from public.device_incidents")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "logs a numbered incident and creation event with authenticated author",
      async () => {
        const row = (await create()).rows[0];
        assert.equal(row.status, "open");
        assert.equal(row.version, 1);
        assert.equal(row.person_name_snapshot, "Sample VA");
        assert.equal(row.device_model_snapshot, "Lenovo ThinkPad");
        assert.equal(row.created_by, admin);
        assert.equal(row.created_by_email, "admin@example.com");
        assert.ok(Number(row.ticket_number) > 0);
        assert.equal(
          (await query("select * from public.incident_events")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "creation retries do not duplicate records and changed payloads are rejected",
      async () => {
        await create();
        assert.equal(
          (await query("select * from public.device_incidents")).rows.length,
          1,
        );
        assert.equal(
          (await query("select * from public.incident_events")).rows.length,
          1,
        );
        await assert.rejects(create(incident, { title: "Different problem" }));
      },
    );
    await t.test(
      "allows an unregistered device while preserving device notes",
      async () => {
        const row = (
          await create(id(30), {
            device: null,
            label: "Personal laptop not yet registered",
          })
        ).rows[0];
        assert.equal(row.device_id, null);
        assert.equal(
          row.device_model_snapshot,
          "Personal laptop not yet registered",
        );
      },
    );
    await t.test(
      "non-admin and anonymous users cannot read or write IT records",
      async () => {
        for (const user of [va, other]) {
          await asUser(user);
          assert.equal(
            (await query("select * from public.device_incidents")).rows.length,
            0,
          );
          assert.equal(
            (await query("select * from public.incident_events")).rows.length,
            0,
          );
          await assert.rejects(create(id(40)));
          await assert.rejects(update(id(41), 1));
          await assert.rejects(
            query("insert into public.device_incidents(id) values($1)", [
              id(42),
            ]),
          );
        }
        await db.exec("reset role; set role anon");
        await assert.rejects(query("select * from public.device_incidents"));
        await assert.rejects(create(id(43)));
        await asUser(admin);
      },
    );
    await t.test(
      "admin cannot bypass the RPC to overwrite or delete incident history",
      async () => {
        await assert.rejects(
          query("update public.device_incidents set status='closed'"),
        );
        await assert.rejects(query("delete from public.device_incidents"));
        await assert.rejects(
          query("update public.incident_events set note='tampered'"),
        );
        await assert.rejects(query("delete from public.incident_events"));
      },
    );
    await t.test(
      "updates create an activity event and reject stale competing writes",
      async () => {
        const row = (await update(id(50), 1)).rows[0];
        assert.equal(row.status, "in_progress");
        assert.equal(row.version, 2);
        await assert.rejects(
          update(id(51), 1, { note: "Stale competing update" }),
          /changed/,
        );
        await update(id(50), 1); // A retry is idempotent despite the older version.
        assert.equal(
          (
            await query(
              "select * from public.incident_events where incident_id=$1",
              [incident],
            )
          ).rows.length,
          2,
        );
        await assert.rejects(update(id(50), 1, { note: "Changed retry" }));
      },
    );
    await t.test(
      "requires resolution notes and keeps failed saves atomic",
      async () => {
        await assert.rejects(
          update(id(60), 2, { status: "resolved", note: "", resolution: "" }),
        );
        assert.equal((await current()).version, 2);
        const row = (
          await update(id(61), 2, {
            status: "resolved",
            note: "Verified stable operation.",
            resolution: "Replaced faulty charger and retested.",
          })
        ).rows[0];
        assert.equal(row.version, 3);
        assert.ok(row.resolved_at);
        assert.equal(row.closed_at, null);
      },
    );
    await t.test(
      "closed incidents remain queryable and reopening preserves old resolutions in history",
      async () => {
        const closed = (
          await update(id(70), 3, {
            status: "closed",
            note: "Confirmed with VA.",
            resolution: "Replaced faulty charger and retested.",
          })
        ).rows[0];
        assert.ok(closed.closed_at);
        const reopened = (
          await update(id(71), 4, {
            status: "open",
            note: "Problem returned; reopened for investigation.",
          })
        ).rows[0];
        assert.equal(reopened.resolved_at, null);
        assert.equal(reopened.closed_at, null);
        assert.equal(reopened.resolution, "");
        const history = (
          await query(
            "select * from public.incident_events where incident_id=$1",
            [incident],
          )
        ).rows;
        assert.ok(
          history.some((event) => event.resolution.includes("faulty charger")),
        );
      },
    );
    await t.test(
      "archiving and reassigning assets preserves the original incident context",
      async () => {
        await query(
          "update public.devices set model='Renamed model',person_id=$1,archived=true where id=$2",
          [otherPerson, device],
        );
        await query("update public.va_people set archived=true where id=$1", [
          person,
        ]);
        const row = await current();
        assert.equal(row.person_name_snapshot, "Sample VA");
        assert.equal(row.device_model_snapshot, "Lenovo ThinkPad");
        await assert.rejects(create(id(80)));
        await update(id(81), 5, {
          status: "waiting_va",
          note: "Waiting for replacement details.",
        });
        assert.equal((await current()).status, "waiting_va");
      },
    );
  } finally {
    await db.close();
  }
});
