// db/055 permanent widget keys: who can set them, service-only session opening, widget case shape,
// demo-only client inserts, the visitor view and the owner-set questions-per-conversation cap. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-widget-keys-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-widget-keys-db: refusing non-local host'); process.exit(1); }
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
const KEY_A = 'pk_live_' + 'A'.repeat(23) + '1', KEY_A2 = 'pk_test_' + 'B'.repeat(23) + '2';
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID(), managerA = randomUUID();
    for (const u of [A, B, agentA, managerA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@keys.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent'),($1,$3,'manager')", [A, agentA, managerA]);

    // Key management: manager+ through the RPC only.
    await as(agentA, A); await rejects('select rotate_widget_key($1)', [KEY_A], /Manager role required/);
    await as(A); await rejects('select rotate_widget_key($1)', ['pk_live_short'], /Invalid key/);
    assert.equal((await one('select rotate_widget_key($1) r', [KEY_A])).r, true); ok();
    assert.equal((await one('select public_key,key_active from widget_settings where user_id=$1', [A])).public_key, KEY_A); ok();
    await rejects("update widget_settings set public_key=$1 where user_id=$2", [KEY_A2, A], /go through rotate_widget_key/);
    await rejects("update widget_settings set key_active=false where user_id=$1", [A], /go through rotate_widget_key/);
    await c.query("update widget_settings set label='Help desk' where user_id=$1", [A]); ok(); // other columns still editable
    await as(managerA, A); assert.equal((await one('select rotate_widget_key($1) r', [KEY_A2])).r, true); ok();
    assert.equal((await one('select set_widget_key_active(false) r')).r, true); ok();
    await as(B); assert.equal((await one('select set_widget_key_active(true) r')).r, false, 'B has no key'); ok();
    await rejects('select rotate_widget_key($1)', [KEY_A2], /duplicate key|unique/);

    // Anonymous and signed-in clients cannot read keys' settings or open sessions.
    for (const who of [null, A] as const) {
      await as(who);
      await rejects('select widget_key_view($1)', [KEY_A2], /permission denied/);
      await rejects('select widget_open_session($1,$2)', [KEY_A2, sha('x')], /permission denied/);
    }
    // Service role: inactive key gives nothing; old key gives nothing; active key works.
    await as('service');
    assert.equal((await one('select widget_key_view($1) v', [KEY_A2])).v, null, 'inactive'); ok();
    assert.equal((await one('select widget_open_session($1,$2) v', [KEY_A2, sha('x')])).v, null, 'inactive session'); ok();
    await as(A); await one('select set_widget_key_active(true)');
    await as('service');
    assert.equal((await one('select widget_key_view($1) v', [KEY_A])).v, null, 'rotated-out key'); ok();
    const view = (await one('select widget_key_view($1) v', [KEY_A2])).v;
    assert.equal(view.label, 'Help desk'); assert.equal(view.mode, 'test'); ok();
    await rejects('select widget_open_session($1,$2)', [KEY_A2, 'nothex'], /Invalid token/);
    const tok = randomUUID() + randomUUID();
    const opened = (await one('select widget_open_session($1,$2) v', [KEY_A2, sha(tok)])).v;
    assert.ok(opened.id && opened.expiresAt); ok();
    const row = await one('select user_id,source,fictional,order_label,amount,expires_at-now()>interval \'23 hours\' long from support_cases where id=$1', [opened.id]);
    assert.deepEqual([row.user_id, row.source, row.fictional, row.order_label, row.amount, row.long], [A, 'widget', false, null, null, true]); ok();

    // The visitor view of a widget case: no fixture order, labelled as a website chat.
    await as(null);
    const v = (await one('select support_case_view($1) v', [sha(tok)])).v;
    assert.deepEqual([v.source, v.fictional, v.order, v.amount, v.status], ['widget', false, null, null, 'Website chat']); ok();

    // Signed-in clients still create demo cases only, and demo cases keep their fixture shape.
    await as(A);
    await rejects("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount,fictional,source) values($1,$2,$3,now()+interval '1 hour',null,null,false,'widget')", [randomUUID(), A, sha(randomUUID())], /row-level security|violates/);
    await rejects("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour',null,19)", [randomUUID(), A, sha(randomUUID())], /source_shape|null value/);
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Fictional order',19)", [randomUUID(), A, sha(randomUUID())]); ok();

    // Owner-set questions per conversation (controls.maxQuestions), enforced in the database.
    await c.query("update widget_settings set controls=controls||'{\"maxQuestions\":2}' where user_id=$1", [A]);
    await as(null);
    await one('select support_reserve_knowledge($1,$2)', [sha(tok), 'first question']);
    await one('select support_reserve_knowledge($1,$2)', [sha(tok), 'second question']); ok();
    await rejects('select support_reserve_knowledge($1,$2)', [sha(tok), 'third question'], /Conversation question limit reached/);
    await as(A); await c.query("update widget_settings set controls=controls||'{\"maxQuestions\":\"lots\"}' where user_id=$1", [A]);
    await as(null); await one('select support_reserve_knowledge($1,$2)', [sha(tok), 'non-number falls back to 20']); ok();

    console.log(`PASS widget keys DB (055): ${n} checks; manager+ via RPC only, direct key edits refused, service-only view/session, inactive and rotated keys closed, widget case shape and view, demo-only client inserts, per-conversation cap. Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
