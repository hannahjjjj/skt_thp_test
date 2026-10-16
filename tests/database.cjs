const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
  const db=new PGlite();
  try {
    // Minimal Supabase Auth roles/functions for local PostgreSQL RLS validation.
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      create publication supabase_realtime;`);
    const migration=await fs.readFile(path.join(root,'supabase/001_create_sales.sql'),'utf8');
    const seed=await fs.readFile(path.join(root,'supabase/002_seed_sales.sql'),'utf8');
    await db.exec(migration);await db.exec(seed);
    const summary=(await db.query('select count(*)::int as count,sum(revenue)::bigint as revenue,sum(quantity)::int as quantity from public.sales')).rows[0];
    assert.equal(summary.count,1017);assert.equal(Number(summary.revenue),515999400);assert.equal(summary.quantity,1722);
    const expected=JSON.parse(execFileSync('python3',['tests/verify_data.py'],{cwd:root,encoding:'utf8'})).rows;
    const imported=(await db.query('select id,sale_date::text,region,store,product,plan,quantity,revenue,staff from public.sales order by id')).rows;
    assert.deepEqual(imported.map(r=>({...r,id:Number(r.id),revenue:Number(r.revenue)})),expected.map(({duplicate,...r})=>({id:r.id,sale_date:r.date,region:r.region,store:r.store,product:r.product,plan:r.plan,quantity:r.quantity,revenue:r.revenue,staff:r.staff})));
    const publications=await db.query("select * from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='sales'");
    assert.equal(publications.rows.length,1);
    await assert.rejects(db.exec(seed),/sales is not empty/);await db.exec('rollback');
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n,1017);
    await assert.rejects(db.exec(migration),/already exists/);await db.exec('rollback');
    const reader='00000000-0000-0000-0000-000000000001',outsider='00000000-0000-0000-0000-000000000002';
    await db.exec(`insert into auth.users values ('${reader}'),('${outsider}');insert into public.dashboard_readers values ('${reader}');`);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.sales'),/permission denied/);
    await db.exec('reset role;set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from public.dashboard_readers')).rows[0].n,0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[reader]);
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n,1017);
    await assert.rejects(db.exec("update public.sales set revenue=0"),/permission denied/);
    await assert.rejects(db.exec('delete from public.sales'),/permission denied/);
    await assert.rejects(db.exec(`insert into public.dashboard_readers values ('${outsider}')`),/permission denied/);
    await db.exec('reset role');
    await db.exec("insert into public.sales(sale_date,region,store,product,quantity,revenue) values ('2027-01-01','서울','신규점','기기',1,10)");
    assert.equal(Number((await db.query('select max(id) as id from public.sales')).rows[0].id),1019);
    console.log('PASS: local PostgreSQL schema, all 1,017 seed rows, totals, identity, publication, repeat-import protection, and anonymous/unauthorized/reader RLS permissions. Remote project not modified.');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
