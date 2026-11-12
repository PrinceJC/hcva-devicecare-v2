import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine; only Supabase's Auth schema / JWT context is stubbed.
// Also run an integration smoke test against local Supabase before production.
test('migration, authorization, inspection transactions, scheduling and history', async () => {
 const db = new PGlite();
 const admin='00000000-0000-4000-8000-000000000001';
 const va='00000000-0000-4000-8000-000000000002';
 const other='00000000-0000-4000-8000-000000000003';
 const person='00000000-0000-4000-8000-000000000004';
 const device='00000000-0000-4000-8000-000000000005';
 const request='00000000-0000-4000-8000-000000000006';
 const query=(sql,params=[])=>db.query(sql,params);
 const asUser=async id=>{await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 try {
 await db.exec(`create role anon; create role authenticated;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261021000100_devicecare.sql',import.meta.url),'utf8'));
 await query('insert into auth.users values ($1),($2),($3)',[admin,va,other]);
 await query('insert into devicecare_private.admins values($1)',[admin]);
 await query("insert into public.va_people(id,auth_user_id,full_name) values($1,$2,'Sample VA')",[person,va]);
 await query("insert into public.devices(id,person_id,model,next_due_date) values($1,$2,'Sample laptop','2026-01-01')",[device,person]);
 await asUser(other);
 assert.equal((await query('select * from public.devices')).rows.length,0);
 assert.equal((await query('select * from public.device_schedule')).rows.length,0);
 await assert.rejects(query("insert into public.va_people(full_name) values('Spoof')"));
 await assert.rejects(query('insert into devicecare_private.admins values($1)',[other]));
 const codes=(await query('select code from public.maintenance_checks')).rows.map(r=>r.code);
 const results=Object.fromEntries(codes.map(c=>[c,'pass']));
 const complete=(id=request,date='2026-01-31',r=results,findings='')=>query('select (public.complete_inspection($1,$2,$3,$4::jsonb,$5)).*',[id,device,date,JSON.stringify(r),findings]);
 await assert.rejects(complete());
 await asUser(va);
 assert.equal((await query('select * from public.devices')).rows.length,1);
 assert.equal((await query('select * from public.device_schedule')).rows.length,1);
 assert.equal((await query("update public.devices set model='Forbidden' returning id")).rows.length,0);
 await assert.rejects(complete());
 await asUser(admin);
 await assert.rejects(complete(request,'2999-01-01'));
 await assert.rejects(complete(request,'2026-01-31',{hardware:'pass'}));
 await assert.rejects(complete(request,'2026-01-31',{...results,hardware:'fail'}));
 await assert.rejects(complete(request,'2026-01-31',{...results,hardware:null}));
 await assert.rejects(complete(request,'2026-01-31',Object.fromEntries(codes.map(c=>[c,'na']))));
 assert.equal((await query('select * from public.inspections')).rows.length,0);
 assert.equal((await query('select next_due_date::text from public.devices')).rows[0].next_due_date,'2026-01-01');
 let saved=(await complete()).rows[0];
 assert.equal(saved.next_due_date.toISOString().slice(0,10),'2026-04-30');
 await complete(); // Same request is safe to retry.
 assert.equal((await query('select * from public.inspections')).rows.length,1);
 await assert.rejects(complete(request,'2026-02-01'));
 await assert.rejects(query('update public.devices set needs_attention=true'));
 await assert.rejects(query('delete from public.inspections'));
 const second='00000000-0000-4000-8000-000000000007';
 await complete(second,'2026-02-01',{...results,battery:'fail'},'Battery fails charging; replace charger and retest.');
 assert.equal((await query('select needs_attention from public.devices')).rows[0].needs_attention,true);
 await assert.rejects(complete('00000000-0000-4000-8000-000000000008','2026-01-15'));
 await query('select public.resolve_device_issue($1,$2)',[device,'Replaced charger and verified normal charging.']);
 assert.equal((await query('select needs_attention from public.devices')).rows[0].needs_attention,false);
 assert.equal((await query('select * from public.issue_resolutions')).rows.length,1);
 await asUser(va);
 assert.equal((await query('select * from public.inspections')).rows.length,2);
 await assert.rejects(query('select public.resolve_device_issue($1,$2)',[device,'Spoof']));
 await asUser(other);
 assert.equal((await query('select * from public.inspections')).rows.length,0);
 assert.equal((await query('select * from public.issue_resolutions')).rows.length,0);
 await db.exec('reset role; set role anon');
 await assert.rejects(query('select * from public.devices'));
 await assert.rejects(complete());
 } finally { await db.close(); }
});
