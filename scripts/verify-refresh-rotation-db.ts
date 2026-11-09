// 052 DB checks: scheduled refresh rotation (knowledge_refresh_checks) and sitemap memory (refresh_seen_urls).
// Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {COMP_FIXTURES_SQL} from './test-plan-fixture';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-refresh-rotation-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-refresh-rotation-db: refusing non-local database host ${host}`); process.exit(1); }
const c = new Client({connectionString: local});
let n = 0;
const ok = () => { n++; };
async function as(user: string | null | 'service', workspace?: string) {
  await c.query('RESET ROLE');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user && user !== 'service' ? user : '']);
  await c.query("select set_config('request.headers',$1,true)", [JSON.stringify(workspace ? {'x-workspace-id': workspace} : {})]);
  await c.query(user === 'service' ? 'SET LOCAL ROLE service_role' : user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
}
async function rejects(sql: string, args: unknown[], match: RegExp) {
  await c.query('SAVEPOINT x');
  await assert.rejects(() => c.query(sql, args), (e: Error) => match.test(e.message) || (console.error('unexpected error:', e.message), false));
  await c.query('ROLLBACK TO SAVEPOINT x');
  ok();
}
const one = async (sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows[0];
const val = async (sql: string, args: unknown[] = []) => Object.values((await one(sql, args)) ?? {})[0];
const SITEMAP = 'https://shop.example/sitemap.xml';
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');await c.query(COMP_FIXTURES_SQL);
    const A = randomUUID(), B = randomUUID(), managerA = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, managerA, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@p52.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager'),($1,$3,'agent')", [A, managerA, agentA]);

    // ---------- access ----------
    for (const role of [null, agentA] as const) {
      await as(role, role ? A : undefined);
      await rejects("select service_refresh_unseen($1,'[]')", [A], /permission denied/);
      await rejects("select service_refresh_record($1,'[]','{}','[]','[]')", [A], /permission denied/);
      await rejects('select * from knowledge_refresh_checks', [], /permission denied/);
      await rejects('select * from refresh_seen_urls', [], /permission denied/);
    }

    // ---------- rotation: 20 saved website pages, 15 per run ----------
    await as(managerA, A);
    assert.equal(await val('select set_refresh_settings($1,$2)', ['weekly', SITEMAP]), true);
    await c.query('RESET ROLE');
    const docs: string[] = [];
    for (let i = 0; i < 20; i++) { const id = randomUUID(); docs.push(id); await c.query("insert into knowledge_documents(id,user_id,title,content,published,created_at) values($1,$2,$3,$4,true,now()-make_interval(mins=>$5))", [id, A, 'Page ' + i, `Source: https://shop.example/p${i}\n\nText of page ${i} for the store.`, 100 - i]); }
    const bDoc = randomUUID();
    await c.query("insert into knowledge_documents(id,user_id,title,content,published) values($1,$2,'B page','Source: https://b.example/x\n\nB text for the B store.',true)", [bDoc, B]);
    await as('service');
    let srcs = await val('select service_refresh_sources($1)', [A]) as {id: string; checkedAt: string | null}[];
    assert.equal(srcs.length, 20); assert.ok(srcs.every((s) => s.checkedAt === null)); ok();
    const firstRun = srcs.slice(0, 15).map((s) => s.id);
    assert.equal(await val("select service_refresh_record($1,'[]','{\"checked\":15}',$2,'[]')", [A, JSON.stringify([...firstRun, bDoc, 'not-a-uuid'])]), 0);
    await c.query('RESET ROLE');
    assert.equal(await val('select count(*)::int from knowledge_refresh_checks where user_id=$1', [A]), 15); assert.equal(await val('select count(*)::int from knowledge_refresh_checks where document_id=$1', [bDoc]), 0, "another workspace's document is ignored"); ok();
    await as('service');
    srcs = await val('select service_refresh_sources($1)', [A]) as {id: string; checkedAt: string | null}[];
    const unchecked = docs.filter((d) => !firstRun.includes(d));
    assert.deepEqual(srcs.slice(0, 5).map((s) => s.id).sort(), [...unchecked].sort(), 'never-checked pages come first'); assert.ok(srcs.slice(5).every((s) => s.checkedAt)); ok();
    const secondRun = srcs.slice(0, 15).map((s) => s.id);
    assert.equal(new Set([...firstRun, ...secondRun]).size, 20, 'all 20 pages are re-checked within two runs'); ok();
    await val("select service_refresh_record($1,'[]','{}',$2,'[]')", [A, JSON.stringify(secondRun)]);
    srcs = await val('select service_refresh_sources($1)', [A]) as {id: string; checkedAt: string | null}[];
    assert.deepEqual(srcs.slice(0, 5).map((s) => s.id).sort(), firstRun.filter((d) => !secondRun.includes(d)).sort(), 'then the least recently checked'); ok();
    // More than 30 saved pages: the never-checked ones are still listed.
    await c.query('RESET ROLE');
    const extra: string[] = [];
    for (let i = 20; i < 40; i++) { const id = randomUUID(); extra.push(id); await c.query('insert into knowledge_documents(id,user_id,title,content,published) values($1,$2,$3,$4,true)', [id, A, 'Page ' + i, `Source: https://shop.example/p${i}\n\nText of page ${i} for the store.`]); }
    await as('service');
    srcs = await val('select service_refresh_sources($1)', [A]) as {id: string; checkedAt: string | null}[];
    assert.equal(srcs.length, 30); assert.deepEqual(srcs.slice(0, 20).map((s) => s.id).sort(), [...extra].sort()); ok();

    // ---------- sitemap memory ----------
    const urls = ['https://shop.example/n1', 'https://shop.example/n2', 'https://shop.example/n3'];
    let un = await val('select service_refresh_unseen($1,$2)', [A, JSON.stringify(urls)]) as {baseline: boolean; unseen: string[]};
    assert.deepEqual(un, {baseline: true, unseen: urls}, 'nothing remembered yet: baseline'); ok();
    await val("select service_refresh_record($1,'[]','{}','[]',$2)", [A, JSON.stringify([...urls.slice(0, 2), 'ftp://bad.example/x', 'https://shop.example/n1'])]);
    un = await val('select service_refresh_unseen($1,$2)', [A, JSON.stringify(urls)]) as {baseline: boolean; unseen: string[]};
    assert.deepEqual(un, {baseline: false, unseen: ['https://shop.example/n3']}, 'remembered URLs are not new'); ok();
    await c.query('RESET ROLE');
    assert.equal(await val('select count(*)::int from refresh_seen_urls where user_id=$1', [A]), 2, 'invalid and duplicate URLs are not stored'); ok();
    await as('service');
    // A proposed and then dismissed page is never proposed again, even before it is remembered.
    await val('select service_refresh_record($1,$2,$3)', [A, JSON.stringify([{kind: 'new', url: 'https://shop.example/n3', title: 'N3', content: 'Source: https://shop.example/n3\n\nA new page for review.'}]), '{}']);
    await as(managerA, A);
    assert.equal(await val("select resolve_refresh_item((select id from knowledge_refresh_items where url='https://shop.example/n3'),'dismissed')"), true);
    await as('service');
    un = await val('select service_refresh_unseen($1,$2)', [A, JSON.stringify([...urls, 'https://shop.example/n4'])]) as {baseline: boolean; unseen: string[]};
    assert.deepEqual(un.unseen, ['https://shop.example/n4'], 'a dismissed page stays dismissed'); ok();
    assert.deepEqual((await val('select service_refresh_unseen($1,$2)', [A, '{"not":"an array"}']) as {unseen: unknown[]}).unseen, []); ok();
    await rejects("select service_refresh_record($1,'[]','{}','{}','[]')", [A], /Invalid refresh run/);
    // Another workspace has its own memory.
    assert.equal((await val('select service_refresh_unseen($1,$2)', [B, JSON.stringify(urls)]) as {baseline: boolean}).baseline, true); ok();
    // Same sitemap URL keeps the memory; a different one starts a new baseline.
    await as(managerA, A);
    assert.equal(await val('select set_refresh_settings($1,$2)', ['daily', SITEMAP]), true);
    await c.query('RESET ROLE');
    assert.equal(await val('select count(*)::int from refresh_seen_urls where user_id=$1', [A]), 2, 'same sitemap: kept'); ok();
    await as(managerA, A);
    assert.equal(await val('select set_refresh_settings($1,$2)', ['daily', 'https://shop.example/other-sitemap.xml']), true);
    await c.query('RESET ROLE');
    assert.equal(await val('select count(*)::int from refresh_seen_urls where user_id=$1', [A]), 0, 'new sitemap: new baseline'); ok();
    await as('service');
    await val("select service_refresh_record($1,'[]','{}','[]',$2)", [A, JSON.stringify(urls)]);
    // Cap: at most 5000 remembered URLs per workspace.
    await c.query('RESET ROLE');
    await c.query("insert into refresh_seen_urls(user_id,url,first_seen_at) select $1,'https://shop.example/bulk/'||k,now()-interval '1 day' from generate_series(1,5100) k", [A]);
    await as('service');
    await val("select service_refresh_record($1,'[]','{}','[]',$2)", [A, JSON.stringify(['https://shop.example/newest'])]);
    await c.query('RESET ROLE');
    assert.equal(await val('select count(*)::int from refresh_seen_urls where user_id=$1', [A]), 5000); assert.equal(await val("select count(*)::int from refresh_seen_urls where user_id=$1 and url='https://shop.example/newest'", [A]), 1, 'the newest is kept'); ok();

    // ---------- deletion ----------
    await c.query('delete from knowledge_documents where id=$1', [docs[0]]);
    assert.equal(await val('select count(*)::int from knowledge_refresh_checks where document_id=$1', [docs[0]]), 0, 'a check goes with its source'); ok();
    await as(A);
    assert.equal(await val("select delete_preview_data('DELETE MY PREVIEW DATA')"), true);
    await c.query('RESET ROLE');
    for (const t of ['knowledge_refresh_checks', 'refresh_seen_urls', 'refresh_settings', 'knowledge_documents']) assert.equal(await val(`select count(*)::int from ${t} where user_id=$1`, [A]), 0, t + ' cleared');
    assert.equal(await val('select count(*)::int from knowledge_documents where user_id=$1', [B]), 1, 'B untouched'); ok();
    console.log(`PASS refresh rotation DB (052): ${n} checks; service-only tables and functions refused for anon and agents; least recently checked pages listed first (all 20 within two runs of 15, never-checked first beyond 30); other-workspace and invalid ids ignored; first sitemap read is a baseline; remembered and dismissed URLs are not new; per-workspace memory; same sitemap keeps it, a new sitemap resets it; 5000 cap keeps the newest; cascades with the source and delete_preview_data; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
