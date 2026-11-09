// db/056 widget logo: manager-only set/clear, type/size/shape constraints, version bumps, service-only reads by
// key or live conversation, logoVersion in the visitor views (never the image). Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-widget-logo-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-widget-logo-db: refusing non-local host'); process.exit(1); }
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
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString('base64');
const KEY = 'pk_live_' + 'L'.repeat(23) + '9';
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), agentA = randomUUID(), B = randomUUID();
    for (const u of [A, agentA, B]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@logo.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [A, agentA]);
    await as(agentA, A); await rejects('select set_widget_logo($1,$2)', ['image/png', PNG], /Manager role required/);
    await as(A);
    await rejects('select set_widget_logo($1,$2)', ['image/svg+xml', PNG], /logo_type_check|violates check/);
    await rejects('select set_widget_logo($1,$2)', ['image/png', 'not base64!'], /logo_data_check|violates check/);
    await rejects('select set_widget_logo($1,$2)', ['image/png', 'A'.repeat(136540)], /logo_data_check|violates check/);
    await rejects('select set_widget_logo($1,$2)', ['image/png', null], /Invalid logo/);
    assert.equal((await one('select set_widget_logo($1,$2) v', ['image/png', PNG])).v, 1); ok();
    assert.equal((await one('select set_widget_logo($1,$2) v', ['image/png', PNG])).v, 2, 'version bumps on every upload'); ok();
    await one('select rotate_widget_key($1)', [KEY]);
    const tok = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Fictional order',19)", [randomUUID(), A, sha(tok)]);
    const expired = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()-interval '1 minute','Old order',19)", [randomUUID(), A, sha(expired)]);
    // Views carry the version only.
    await as(null);
    const v = (await one('select support_case_view($1) v', [sha(tok)])).v;
    assert.equal(v.branding.logoVersion, 2); assert.ok(!JSON.stringify(v).includes(PNG), 'no image bytes in the view'); ok();
    await rejects('select widget_logo($1,$2)', [KEY, null], /permission denied/);
    await as(A); await rejects('select widget_logo($1,$2)', [KEY, null], /permission denied/);
    await as('service');
    assert.equal((await one('select widget_key_view($1) v', [KEY])).v.logoVersion, 2); ok();
    const byKey = (await one('select widget_logo($1,$2) v', [KEY, null])).v;
    assert.deepEqual([byKey.type, byKey.data, byKey.version], ['image/png', PNG, 2]); ok();
    assert.equal((await one('select widget_logo($1,$2) v', [null, sha(tok)])).v.data, PNG, 'by live conversation'); ok();
    assert.equal((await one('select widget_logo($1,$2) v', [null, sha(expired)])).v, null, 'expired conversation'); ok();
    assert.equal((await one('select widget_logo($1,$2) v', ['pk_live_' + 'Z'.repeat(24), null])).v, null, 'unknown key'); ok();
    await as(A); await one('select set_widget_key_active(false)'); await as('service');
    assert.equal((await one('select widget_logo($1,$2) v', [KEY, null])).v, null, 'turned-off key'); ok();
    // Another workspace's conversation never returns A's logo; clearing removes it from the views.
    await as(B); assert.equal((await one('select set_widget_logo($1,$2) v', [null, null])).v, 1, 'B clears its own (creates its row)'); ok();
    await as(A); await one('select set_widget_logo($1,$2)', [null, null]);
    await as(null); assert.equal((await one('select support_case_view($1) v', [sha(tok)])).v.branding.logoVersion, null, 'cleared'); ok();
    console.log(`PASS widget logo DB (056): ${n} checks; manager-only, SVG/garbage/oversize refused, version bumps, service-only reads by active key or live conversation, views carry the version not the bytes, clear works. Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
