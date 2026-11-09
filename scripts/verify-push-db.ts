// db/063 push subscriptions: own devices only, 10 per person, endpoint reuse moves a device, keys never readable
// by clients, service targets = this workspace's owner and members (not other workspaces, not removed
// members), 404/410 deletes and repeated failures stop sends, preview-data deletion. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-push-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-push-db: refusing non-local host'); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
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
const P256 = 'B' + 'x'.repeat(86), AUTH = 'a'.repeat(22);
const ep = (s: string) => `https://fcm.googleapis.com/fcm/send/${s}`;
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID(), gone = randomUUID();
    for (const u of [A, B, agentA, gone]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@push.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent'),($1,$3,'agent')", [A, agentA, gone]);
    const tok = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Push fixture',19)", [randomUUID(), A, sha(tok)]);
    await as(null); await rejects('select save_push_subscription($1,$2,$3,null)', [ep('anon'), P256, AUTH], /permission denied/);
    await as(A); await one("select save_push_subscription($1,$2,$3,'Owner iPhone')", [ep('owner'), P256, AUTH]);
    await rejects('select save_push_subscription($1,$2,$3,null)', [ep('bad'), 'short', AUTH], /violates check/);
    await as(agentA, A); await one("select save_push_subscription($1,$2,$3,'Agent Android')", [ep('agent'), P256, AUTH]);
    await as(gone, A); await one("select save_push_subscription($1,$2,$3,'Leaver laptop')", [ep('leaver'), P256, AUTH]);
    await as(B); await one("select save_push_subscription($1,$2,$3,'B phone')", [ep('b'), P256, AUTH]);
    // Clients see their own devices only, and never the keys or endpoint.
    await as(agentA, A); assert.deepEqual((await c.query('select label from push_subscriptions')).rows.map(r => r.label), ['Agent Android']); ok();
    await rejects('select endpoint from push_subscriptions', [], /permission denied/);
    await rejects('select p256dh from push_subscriptions', [], /permission denied/);
    assert.equal((await one('select jsonb_array_length(my_push_targets()) n')).n, 1); ok();
    // 10 devices per person; re-saving an endpoint moves it (no duplicate).
    await as(A);
    for (let i = 0; i < 9; i++) await one('select save_push_subscription($1,$2,$3,null)', [ep('o' + i), P256, AUTH]);
    await rejects('select save_push_subscription($1,$2,$3,null)', [ep('o-eleventh'), P256, AUTH], /Ten devices maximum/);
    await one("select save_push_subscription($1,$2,$3,'Owner iPhone renamed')", [ep('owner'), P256, AUTH]); ok();
    assert.equal((await one('select delete_push_subscription($1) r', [ep('agent')])).r, false, "cannot delete someone else's device"); ok();
    // Service targets for the conversation: owner + current members of A only.
    await c.query('RESET ROLE'); await c.query('delete from workspace_members where workspace_id=$1 and user_id=$2', [A, gone]);
    await as('service');
    const t = (await one('select service_push_targets($1) t', [sha(tok)])).t;
    const eps = (t.targets as {endpoint: string}[]).map(x => x.endpoint);
    assert.ok(eps.includes(ep('owner')) && eps.includes(ep('agent'))); assert.ok(!eps.includes(ep('b')), 'other workspace'); assert.ok(!eps.includes(ep('leaver')), 'removed member'); assert.equal(eps.length, 11); ok();
    // Results: 410 deletes; 10 failures stop sends; success resets.
    const id = (t.targets as {id: string; endpoint: string}[]).find(x => x.endpoint === ep('o0'))!.id, id2 = (t.targets as {id: string; endpoint: string}[]).find(x => x.endpoint === ep('o1'))!.id;
    await one('select service_push_result($1,410)', [id]);
    for (let i = 0; i < 10; i++) await one('select service_push_result($1,500)', [id2]);
    const t2 = ((await one('select service_push_targets($1) t', [sha(tok)])).t.targets as {id: string}[]).map(x => x.id);
    assert.ok(!t2.includes(id) && !t2.includes(id2)); ok();
    await one('select service_push_result($1,201)', [id2]);
    assert.ok(((await one('select service_push_targets($1) t', [sha(tok)])).t.targets as {id: string}[]).some(x => x.id === id2), 'success resets'); ok();
    for (const who of [null, A] as const) { await as(who); await rejects('select service_push_targets($1)', [sha(tok)], /permission denied/); }
    // Preview-data deletion removes this workspace's devices.
    await as(A); await one("select delete_preview_data('DELETE MY PREVIEW DATA')");
    await c.query('RESET ROLE'); assert.equal((await one('select count(*)::int n from push_subscriptions where workspace_id=$1', [A])).n, 0); assert.equal((await one('select count(*)::int n from push_subscriptions where workspace_id=$1', [B])).n, 1); ok();
    console.log(`PASS push DB (063): ${n} checks; own devices only, keys and endpoints never readable by clients, 10 per person, re-save moves a device, targets are this workspace's owner and current members, 410 deletes, 10 failures stop sends, success resets, service-only, preview deletion. Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
