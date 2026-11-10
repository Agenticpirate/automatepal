// End to end for the sources refresh API (POST /api/v1/sources/refresh, db/064) against a LOCAL app and the LOCAL
// Supabase, with a real local auth user. The workspace has no saved website pages, so nothing is fetched. Usage:
//   E2E_APP=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=… SERVICE_ROLE_KEY=… \
//   LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/verify-refresh-api-e2e.mjs
import assert from 'node:assert/strict';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import pg from 'pg';
const {E2E_APP: APP, SUPABASE_URL: SB, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE, LOCAL_DATABASE_URL: DB} = process.env;
if (!APP || !SB || !ANON || !SERVICE || !DB) { console.error('Set E2E_APP, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, LOCAL_DATABASE_URL.'); process.exit(1); }
for (const u of [APP, SB, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
let n = 0;
const ok = () => { n++; };
const db = new pg.Client({connectionString: DB});
await db.connect();
const email = `refresh-${randomUUID().slice(0, 8)}@refresh-e2e.example.test`;
const u = await (await fetch(`${SB}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123', email_confirm: true})})).json();
const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: ANON, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123'})})).json();
const mint = async (scope) => { const token = 'ap_ro_' + randomBytes(32).toString('hex'); const r = await fetch(`${SB}/rest/v1/rpc/create_readonly_token`, {method: 'POST', headers: {apikey: ANON, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({p_label: 'e2e ' + scope, p_hash: createHash('sha256').update(token).digest('hex'), p_scope: scope, p_hours: 1})}); assert.equal(r.status, 200, await r.text()); return token; };
const refresh = (token, method = 'POST') => fetch(`${APP}/api/v1/sources/refresh`, {method, headers: token ? {Authorization: `Bearer ${token}`} : {}}).then(async r => ({status: r.status, retry: r.headers.get('retry-after'), cache: r.headers.get('cache-control'), body: await r.json()}));
try {
  await db.query("select public.set_manual_plan($1,'growth')", [u.id]);
  const token = await mint('sources:refresh'), chatToken = await mint('chat:write'); ok();
  // Refused: no token, malformed token, a token with another scope, GET.
  let r = await refresh(null); assert.equal(r.status, 401);
  r = await refresh('ap_ro_short'); assert.equal(r.status, 401);
  r = await refresh(chatToken); assert.equal(r.status, 401, JSON.stringify(r.body)); ok();
  r = await refresh(token, 'GET'); assert.equal(r.status, 405); ok();
  // A run: counts only, nothing fetched for a workspace without saved pages.
  r = await refresh(token);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); assert.equal(r.cache, 'no-store');
  assert.deepEqual([r.body.checked, r.body.changed, r.body.added, r.body.removed, r.body.queuedForReview], [0, 0, 0, 0, 0]);
  assert.deepEqual(Object.keys(r.body).filter(k => !['ok', 'checked', 'changed', 'added', 'removed', 'skipped', 'sitemap', 'stoppedBy', 'queuedForReview'].includes(k)), [], 'counts only'); ok();
  // Too soon: 429 with the wait in seconds.
  r = await refresh(token);
  assert.equal(r.status, 429); assert.ok(Number(r.retry) > 0 && Number(r.retry) <= 600); assert.equal(r.body.retryAfter, Number(r.retry)); ok();
  // After the wait it runs again; a plan without API access closes it.
  await db.query("update api_refresh_requests set last_at=now()-interval '11 minutes' where user_id=$1", [u.id]);
  r = await refresh(token); assert.equal(r.status, 200); ok();
  await db.query("update api_refresh_requests set last_at=now()-interval '11 minutes' where user_id=$1", [u.id]);
  await db.query("select public.set_manual_plan($1,'starter')", [u.id]);
  r = await refresh(token); assert.equal(r.status, 401); ok();
  console.log(`PASS refresh API end to end: ${n} checks; real local auth user and app: tokens created through the signed-in RPC, missing/malformed/other-scope tokens and GET refused, a run answers counts only, 429 with Retry-After inside 10 minutes, runs again after the wait, plan without API access closes it.`);
} finally {
  await fetch(`${SB}/auth/v1/admin/users/${u.id}`, {method: 'DELETE', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`}}).catch(() => {});
  await db.end();
}
