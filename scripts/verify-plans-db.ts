// db/057 plans and subscriptions: SQL limits equal lib/plans.ts, effective plan through the subscription
// lifecycle (active, suspended with grace, cancelled until period end, expired), late events for an older
// subscription ignored, manual comps, service-only writes, idempotent webhook ids, plan-based quotas
// (monthly AI answers, sources/pages, seats), my_plan usage. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {PLANS, PLAN_KEYS} from '../lib/plans';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-plans-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-plans-db: refusing non-local host'); process.exit(1); }
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
const plan = async (ws: string) => (await one('select public.workspace_plan($1) p', [ws])).p as string;
const sync = (ws: string, sub: string, p: string, i: string | null, st: string, end: string | null) => one('select public.sync_paypal_subscription($1,$2,$3,$4,$5,$6) r', [ws, sub, p, i, st, end]);
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    // 1. SQL limits equal lib/plans.ts.
    for (const k of PLAN_KEYS) {
      const l = (await one('select public.plan_limits($1) l', [k])).l;
      const p = PLANS[k];
      assert.deepEqual(l, {plan: k, messages: p.messages, pages: p.pages, sources: p.sources, seats: p.seats, bots: p.bots, refresh: p.refresh, features: p.features}, `plan_limits(${k}) matches lib/plans.ts`);
    }
    assert.equal((await one("select public.plan_limits('bogus')->>'plan' p")).p, 'free'); ok();

    const A = randomUUID(), B = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@plans.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [A, agentA]);
    // 2. Writes are service-only; members read their own workspace's row.
    for (const who of [null, A] as const) {
      await as(who);
      await rejects('select public.sync_paypal_subscription($1,$2,$3,$4,$5,$6)', [A, 'I-AAAAAAAAAA', 'scale', 'month', 'active', null], /permission denied/);
      await rejects('select public.set_manual_plan($1,$2)', [A, 'enterprise'], /permission denied/);
      await rejects('select public.record_paypal_event($1,$2,$3,$4)', ['WH-1', 'X', null, 'synced'], /permission denied/);
    }
    await as(A); await rejects("insert into workspace_subscriptions(workspace_id,provider,plan_key,status) values($1,'manual','enterprise','active')", [A], /permission denied/);
    await as('service');
    assert.equal(await plan(A), 'free'); ok();
    await rejects('select public.sync_paypal_subscription($1,$2,$3,$4,$5,$6)', [randomUUID(), 'I-AAAAAAAAAA', 'scale', 'month', 'active', null], /Unknown workspace/);
    await rejects('select public.sync_paypal_subscription($1,$2,$3,$4,$5,$6)', [A, 'I-AAAAAAAAAA', 'enterprise', 'month', 'active', null], /violates check/);
    await rejects('select public.sync_paypal_subscription($1,$2,$3,$4,$5,$6)', [A, 'not-an-id', 'scale', 'month', 'active', null], /violates check/);

    // 3. Lifecycle.
    const later = new Date(Date.now() + 20 * 86400e3).toISOString(), past = new Date(Date.now() - 86400e3).toISOString();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'approval_pending', null); assert.equal(await plan(A), 'free', 'not yet approved'); ok();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'active', later); assert.equal(await plan(A), 'growth'); ok();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'suspended', later);
    const g1 = (await one('select grace_until from workspace_subscriptions where workspace_id=$1', [A])).grace_until as Date;
    assert.ok(g1 && g1.getTime() > Date.now() + 6.9 * 86400e3); assert.equal(await plan(A), 'growth', 'grace keeps the plan'); ok();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'suspended', later);
    assert.equal(((await one('select grace_until from workspace_subscriptions where workspace_id=$1', [A])).grace_until as Date).getTime(), g1.getTime(), 'grace not extended by repeat events'); ok();
    await c.query("update workspace_subscriptions set grace_until=now()-interval '1 minute' where workspace_id=$1", [A]);
    assert.equal(await plan(A), 'free', 'grace over'); ok();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'active', later);
    assert.equal((await one('select grace_until from workspace_subscriptions where workspace_id=$1', [A])).grace_until, null, 'active clears grace'); assert.equal(await plan(A), 'growth'); ok();
    await sync(A, 'I-SUB0000001', 'growth', 'month', 'cancelled', null);
    assert.equal(await plan(A), 'growth', 'cancelled keeps access until the paid period ends (period end kept)'); ok();
    await c.query('update workspace_subscriptions set current_period_end=$2 where workspace_id=$1', [A, past]);
    assert.equal(await plan(A), 'free', 'period over'); ok();
    // New subscription replaces it; a late cancel for the old one is ignored.
    await sync(A, 'I-SUB0000002', 'scale', 'year', 'active', later); assert.equal(await plan(A), 'scale'); ok();
    assert.deepEqual((await sync(A, 'I-SUB0000001', 'growth', 'month', 'cancelled', null)).r, {ignored: 'older subscription'}); assert.equal(await plan(A), 'scale'); ok();
    await sync(A, 'I-SUB0000002', 'scale', 'year', 'expired', null); assert.equal(await plan(A), 'free'); ok();
    // Manual comps.
    assert.equal((await one("select public.set_manual_plan($1,'enterprise') p", [B])).p, 'enterprise'); assert.equal((await one('select public.set_manual_plan($1,null) p', [B])).p, 'free'); ok();
    // 4. Idempotent webhook ids.
    assert.equal((await one("select public.record_paypal_event('WH-ABC123','BILLING.SUBSCRIPTION.ACTIVATED','I-SUB0000002','synced') r")).r, true);
    assert.equal((await one("select public.record_paypal_event('WH-ABC123','BILLING.SUBSCRIPTION.ACTIVATED','I-SUB0000002','synced') r")).r, false);
    assert.equal((await one("select public.paypal_event_seen('WH-ABC123') r")).r, true); ok();

    // 5. Plan-based quotas. A is Free again: 100 AI answers per month, 50 sources, 1 seat.
    const tok = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Plans fixture',19)", [randomUUID(), A, sha(tok)]);
    const caseId = (await one('select id from support_cases where token_hash=$1', [sha(tok)])).id;
    await c.query('RESET ROLE');
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count) select $1,$2,'Earlier question '||g,false,0 from generate_series(1,99) g", [A, caseId]);
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count,created_at) select $1,$2,'Last month '||g,false,0,date_trunc('month',now())-interval '1 day' from generate_series(1,50) g", [A, caseId]);
    await c.query("update widget_settings set controls='{}' where user_id=$1", [A]);
    await c.query("insert into widget_settings(user_id,controls) values($1,'{\"maxQuestions\":50}') on conflict(user_id) do update set controls='{\"maxQuestions\":50}'", [A]);
    // The per-conversation cap is 50 max, so use a fresh conversation for the monthly check.
    const tok2 = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Plans fixture 2',19)", [randomUUID(), A, sha(tok2)]);
    await as(null);
    await one('select support_reserve_knowledge($1,$2)', [sha(tok2), 'The 100th answer this month']); ok();
    await rejects('select support_reserve_knowledge($1,$2)', [sha(tok2), 'One too many'], /Monthly message limit reached/);
    await as('service'); await one("select public.set_manual_plan($1,'starter')", [A]); await as(null);
    await one('select support_reserve_knowledge($1,$2)', [sha(tok2), 'Starter allows more']); ok();
    // Sources/pages and seats follow the plan.
    await as('service'); await one('select public.set_manual_plan($1,null)', [A]);
    await c.query('RESET ROLE');
    await c.query("insert into knowledge_documents(id,user_id,title,content) select gen_random_uuid(),$1,'Filler '||g,'Filler content for the plans quota test.' from generate_series(1,50) g", [A]);
    // save_knowledge_source is reached through server-side wrappers; call it with A's claims as the owner role.
    await as(A); await c.query('RESET ROLE');
    const emb = JSON.stringify([{content: 'chunk', embedding: Array(768).fill(0)}]);
    await rejects('select save_knowledge_source($1,null,$2,$3,false,$4)', [randomUUID(), 'One more', 'Content that would exceed the plan.', emb], /Plan limit reached: 50 sources or 50 pages/);
    await as(A);
    await rejects("select create_workspace_invite('new@plans.example.test','agent',$1)", [sha(randomUUID())], /Seat limit reached for your plan/);
    // my_plan for a member.
    await as(agentA, A);
    const mp = (await one('select my_plan() p')).p;
    assert.equal(mp.plan, 'free'); assert.equal(mp.role, 'agent'); assert.equal(mp.usage.messages, 101, "99 earlier + the 100th + one on Starter; refused and last-month answers not counted"); assert.equal(mp.usage.sources, 50); assert.equal(mp.usage.seats, 2); assert.equal(mp.limits.messages, 100); ok();
    await as(B, A); assert.equal((await one('select my_plan() p')).p, null, 'non-member gets nothing'); ok();
    console.log(`PASS plans DB (057): ${n} checks; limits match lib/plans.ts, lifecycle (pending, active, suspended grace, cancelled to period end, expired), late events ignored, manual comps, service-only writes, idempotent webhook ids, monthly answers/sources/seats by plan, my_plan. Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
