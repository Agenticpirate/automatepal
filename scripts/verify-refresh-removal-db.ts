// 053 DB checks: a dismissed 'removed' refresh item is not proposed again while the page stays gone.
// Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-refresh-removal-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-refresh-removal-db: refusing non-local database host ${host}`); process.exit(1); }
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
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), managerA = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, managerA, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@p53.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager'),($1,$3,'agent')", [A, managerA, agentA]);
    // ---------- access ----------
    for (const role of [null, agentA] as const) {
      await as(role, role ? A : undefined);
      await rejects("select service_refresh_record($1,'[]','{}','[]','[]','[]')", [A], /permission denied/);
    }
    await as(managerA, A);
    assert.equal(await val("select set_refresh_settings('weekly','https://shop.example/sitemap.xml')"), true);
    await c.query('RESET ROLE');
    const d1 = randomUUID(), d2 = randomUUID(), bDoc = randomUUID();
    await c.query("insert into knowledge_documents(id,user_id,title,content,published) values($1,$3,'Gone','Source: https://shop.example/gone\n\nA page that left the sitemap.',true),($2,$3,'Other','Source: https://shop.example/other\n\nAnother saved page here.',true)", [d1, d2, A]);
    await c.query("insert into knowledge_documents(id,user_id,title,content,published) values($1,$2,'B page','Source: https://b.example/x\n\nB text for the B store.',true)", [bDoc, B]);
    const removed = (doc: string, url: string) => JSON.stringify([{kind: 'removed', url, title: 'T', documentId: doc, content: null}]);
    const pending = async (doc: string) => Number(await val("select count(*) from knowledge_refresh_items where document_id=$1 and status='pending'", [doc]));
    // ---------- first proposal, then dismissal ----------
    await as('service');
    assert.equal(await val("select service_refresh_record($1,$2,'{}')", [A, removed(d1, 'https://shop.example/gone')]), 1, 'three-argument callers still work');
    await c.query('RESET ROLE'); assert.equal(await pending(d1), 1); ok();
    await as(managerA, A);
    assert.equal(await val("select resolve_refresh_item((select id from knowledge_refresh_items where document_id=$1 and status='pending'),'dismissed')", [d1]), true);
    await as('service');
    assert.equal(await val("select service_refresh_record($1,$2,'{}','[]','[]')", [A, removed(d1, 'https://shop.example/gone')]), 0, 'a dismissed removal is not proposed again');
    await c.query('RESET ROLE'); assert.equal(await pending(d1), 0); ok();
    // Other kinds and other pages are unaffected.
    await as('service');
    assert.equal(await val("select service_refresh_record($1,$2,'{}')", [A, JSON.stringify([{kind: 'changed', url: 'https://shop.example/gone', title: 'Gone', documentId: d1, content: 'Source: https://shop.example/gone\n\nNew text on the page.'}])]), 1, 'a change to the page is still proposed');
    assert.equal(await val("select service_refresh_record($1,$2,'{}')", [A, removed(d2, 'https://shop.example/other')]), 1, 'another page is proposed for removal');
    await c.query('RESET ROLE'); assert.equal(await pending(d2), 1); ok();
    await c.query("update knowledge_refresh_items set status='dismissed',resolved_at=clock_timestamp() where document_id=$1 and status='pending'", [d1]);
    // ---------- live again, then gone again: proposed ----------
    await as('service');
    assert.equal(await val("select service_refresh_record($1,'[]','{}',$2,'[]',$3)", [A, JSON.stringify([d1]), JSON.stringify([d1, bDoc, 'not-a-uuid'])]), 0);
    await c.query('RESET ROLE');
    assert.ok(await val('select live_at is not null from knowledge_refresh_checks where document_id=$1', [d1]), 'live_at recorded');
    assert.equal(await val('select count(*)::int from knowledge_refresh_checks where document_id=$1', [bDoc]), 0, "another workspace's document is ignored"); ok();
    await as('service');
    assert.equal(await val("select service_refresh_record($1,$2,'{}')", [A, removed(d1, 'https://shop.example/gone')]), 1, 'seen live since the dismissal: a new removal is proposed');
    await c.query('RESET ROLE'); assert.equal(await pending(d1), 1); ok();
    // Dismissed again: stays dismissed until it is seen live again.
    await as(managerA, A);
    assert.equal(await val("select resolve_refresh_item((select id from knowledge_refresh_items where document_id=$1 and status='pending'),'dismissed')", [d1]), true);
    await as('service');
    assert.equal(await val("select service_refresh_record($1,$2,'{}','[]','[]','[]')", [A, removed(d1, 'https://shop.example/gone')]), 0);
    await rejects("select service_refresh_record($1,'[]','{}','[]','[]','{}')", [A], /Invalid refresh run/);
    // ---------- deletion ----------
    await as(A);
    assert.equal(await val("select delete_preview_data('DELETE MY PREVIEW DATA')"), true);
    await c.query('RESET ROLE');
    for (const t of ['knowledge_refresh_checks', 'knowledge_refresh_items', 'knowledge_documents']) assert.equal(await val(`select count(*)::int from ${t} where user_id=$1`, [A]), 0, t + ' cleared');
    assert.equal(await val('select count(*)::int from knowledge_documents where user_id=$1', [B]), 1, 'B untouched'); ok();
    console.log(`PASS refresh removal memory DB (053): ${n} checks; recorder refused for anon and agents; a dismissed removal is not proposed again while the page stays gone; changes and other pages still proposed; a page seen live after the dismissal can be proposed again; other-workspace and invalid live ids ignored; invalid p_live refused; cleared by delete_preview_data; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
