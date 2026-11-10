// db/064: sources refresh API. Token scope sources:refresh (admin+, API plan), service-only claim with one run
// per workspace per 10 minutes and 24 per UTC day, same answer for every invalid token. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-refresh-api-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-refresh-api-db: refusing non-local host'); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const ok = () => { n++; };
async function as(user: string | null | 'service') {
  await c.query('RESET ROLE');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user && user !== 'service' ? user : '']);
  await c.query("select set_config('request.headers','{}',true)");
  await c.query(user === 'service' ? 'SET LOCAL ROLE service_role' : user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
}
async function rejects(sql: string, args: unknown[], match: RegExp) {
  await c.query('SAVEPOINT x');
  await assert.rejects(() => c.query(sql, args), (e: Error) => match.test(e.message) || (console.error('unexpected error:', e.message), false));
  await c.query('ROLLBACK TO SAVEPOINT x');
  ok();
}
const one = async (sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows[0];
const claim = async (tok: string) => (await one('select api_refresh_claim($1) r', [sha(tok)])).r;
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID();
    for (const u of [A, B]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@ra.example.test`]);
    const tokA = 'a' + randomUUID(), tokChat = 'c' + randomUUID(), tokB = 'b' + randomUUID();
    // Token creation: plan-gated like the other API scopes; unknown scopes still refused.
    await as(A); await rejects("select create_readonly_token('refresh',$1,'sources:refresh',2)", [sha(tokA)], /Upgrade required: API access/);
    await c.query('RESET ROLE'); await one("select public.set_manual_plan($1,'growth')", [A]); await one("select public.set_manual_plan($1,'growth')", [B]);
    await as(A); await one("select create_readonly_token('refresh',$1,'sources:refresh',2)", [sha(tokA)]); await one("select create_readonly_token('chat',$1,'chat:write',2)", [sha(tokChat)]); ok();
    await rejects("select create_readonly_token('x',$1,'sources:write',2)", [sha('x' + randomUUID())], /Invalid token/);
    assert.equal((await one("select set_refresh_settings('monthly','https://shop.example/sitemap.xml') r")).r, true);
    await as(B); await one("select create_readonly_token('refresh',$1,'sources:refresh',2)", [sha(tokB)]);
    // Clients cannot call the claim or read the request table.
    await as(A); await rejects('select api_refresh_claim($1)', [sha(tokA)], /permission denied/); await rejects('select * from api_refresh_requests', [], /permission denied/);
    await as(null); await rejects('select api_refresh_claim($1)', [sha(tokA)], /permission denied/);
    // Service: wrong scope, unknown, revoked and expired tokens all get NULL.
    await as('service');
    assert.equal(await claim(tokChat), null, 'chat token cannot refresh'); assert.equal(await claim('nope'), null); ok();
    // A valid claim returns the token's own workspace and its sitemap; the next one must wait.
    const first = await claim(tokA);
    assert.equal(first.workspace, A); assert.equal(first.sitemapUrl, 'https://shop.example/sitemap.xml'); ok();
    const again = await claim(tokA);
    assert.equal(again.workspace, undefined); assert.ok(again.retryAfter > 0 && again.retryAfter <= 600, 'cooldown in seconds'); ok();
    // Another workspace is not affected by A's cooldown, and has no sitemap.
    const b = await claim(tokB); assert.equal(b.workspace, B); assert.equal(b.sitemapUrl, null); ok();
    // After the cooldown the same day counts up; the 25th run of the day is refused until tomorrow.
    await c.query('RESET ROLE'); await c.query("update api_refresh_requests set last_at=now()-interval '11 minutes' where user_id=$1", [A]);
    await as('service'); assert.equal((await claim(tokA)).workspace, A);
    await c.query('RESET ROLE'); assert.equal((await one('select day_count from api_refresh_requests where user_id=$1', [A])).day_count, 2); ok();
    await c.query("update api_refresh_requests set last_at=now()-interval '11 minutes',day_count=24 where user_id=$1", [A]);
    await as('service'); const capped = await claim(tokA); assert.equal(capped.workspace, undefined); assert.ok(capped.retryAfter > 0 && capped.retryAfter <= 86400, 'until UTC midnight'); ok();
    // A new day starts the count again.
    await c.query('RESET ROLE'); await c.query("update api_refresh_requests set day=day-1 where user_id=$1", [A]);
    await as('service'); assert.equal((await claim(tokA)).workspace, A);
    await c.query('RESET ROLE'); assert.equal((await one('select day_count from api_refresh_requests where user_id=$1', [A])).day_count, 1); ok();
    // Losing API access or revoking the token closes it.
    await c.query("update api_refresh_requests set last_at=now()-interval '11 minutes' where user_id=$1", [A]);
    await one("select public.set_manual_plan($1,'starter')", [A]); await as('service'); assert.equal(await claim(tokA), null, 'plan without API'); ok();
    await c.query('RESET ROLE'); await one("select public.set_manual_plan($1,'growth')", [A]); await c.query('update readonly_tokens set revoked_at=now() where token_hash=$1', [sha(tokA)]);
    await as('service'); assert.equal(await claim(tokA), null, 'revoked'); ok();
    console.log(`PASS refresh API DB (064): ${n} checks; sources:refresh tokens plan-gated, claim service-only, wrong scope/unknown/revoked/no-API all NULL, own workspace and sitemap returned, 10-minute cooldown, 24 a day, new day resets, other workspaces unaffected.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
