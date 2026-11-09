// db/058-061: answer model tier (deep only on paid plans, weight 10 against the monthly allowance), service
// webhook delivery (plan-gated, by workspace or conversation), chat API conversations (chat:write scope, API
// plan, workspace-bound), Slack alert settings (admin+, plan-gated, URL never readable). Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-phase3-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-phase3-db: refusing non-local host'); process.exit(1); }
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
const SLACK = 'https://hooks.slack.com/services/T0000TEST/B0000TEST/abcdefghij0123456789';
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), managerA = randomUUID();
    for (const u of [A, B, managerA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@p3.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager')", [A, managerA]);
    const caseTok = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','P3 fixture',19)", [randomUUID(), A, sha(caseTok)]);
    await c.query("insert into widget_settings(user_id,controls) values($1,'{\"modelTier\":\"deep\"}')", [A]);

    // 058: deep on Free falls back to fast; on a paid plan it is deep with weight 10.
    await as(null);
    assert.equal((await one('select support_case_view($1) v', [sha(caseTok)])).v.modelTier, 'fast', 'Free: fast'); ok();
    await as('service'); await one("select public.set_manual_plan($1,'starter')", [A]); await as(null);
    assert.equal((await one('select support_case_view($1) v', [sha(caseTok)])).v.modelTier, 'deep'); ok();
    const rid = (await one('select support_reserve_knowledge($1,$2) id', [sha(caseTok), 'A deep question'])).id;
    await c.query('RESET ROLE');
    const row = await one('select model_tier,weight from knowledge_interactions where id=$1', [rid]);
    assert.deepEqual([row.model_tier, row.weight], ['deep', 10]); ok();
    // Monthly allowance counts weights: Starter 4,000 = 399 deep answers + this one... fill to 3,995 and the next deep (10) is refused.
    const caseId = (await one('select id from support_cases where token_hash=$1', [sha(caseTok)])).id;
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count,weight) select $1,$2,'Filler '||g,false,0,5 from generate_series(1,797) g", [A, caseId]);
    const tok2 = randomUUID() + randomUUID();
    await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','P3 fixture 2',19)", [randomUUID(), A, sha(tok2)]);
    await as(null);
    await rejects('select support_reserve_knowledge($1,$2)', [sha(tok2), 'Over the allowance'], /Monthly message limit reached/);
    await as(managerA, A); assert.equal((await one('select my_plan() p')).p.usage.messages, 3995, 'usage sums weights'); assert.equal((await one('select my_plan() p')).p.modelTier, 'deep'); ok();
    await as(null); await rejects('select public.effective_model_tier($1)', [A], /permission denied/);

    // 059: service webhook delivery, gated by plan (Starter has no webhooks; Growth does).
    await c.query('RESET ROLE');
    const wh = (await one("insert into demo_webhooks(user_id,url,enabled,secret) values($1,'https://hooks.example.com/in',true,'s') returning id", [A])).id;
    await c.query("insert into demo_webhook_events(user_id,webhook_id,payload) values($1,$2,'{\"type\":\"demo.support_request\"}')", [A, wh]);
    await as('service');
    assert.deepEqual((await one('select service_webhook_claim(null,$1,5) r', [sha(caseTok)])).r, [], 'Starter: not delivered'); ok();
    await one("select public.set_manual_plan($1,'growth')", [A]);
    assert.deepEqual((await one('select service_webhook_claim($1,null,5) r', [B])).r, [], 'other workspace'); ok();
    const claimed = (await one('select service_webhook_claim(null,$1,5) r', [sha(caseTok)])).r;
    assert.equal(claimed.length, 1); assert.equal(claimed[0].url, 'https://hooks.example.com/in'); assert.equal(claimed[0].attempt, 1); ok();
    assert.deepEqual((await one('select service_webhook_claim(null,null,5) r')).r, [], 'claimed once'); ok();
    assert.equal((await one('select service_webhook_finish($1,500,1) r', [claimed[0].id])).r, true);
    assert.equal((await one('select service_webhook_finish($1,200,1) r', [claimed[0].id])).r, false, 'stale finish ignored'); ok();
    await c.query('RESET ROLE'); await c.query("update demo_webhook_events set next_at=now() where id=$1", [claimed[0].id]); await as('service');
    const again = (await one('select service_webhook_claim($1,null,5) r', [A])).r; assert.equal(again[0].attempt, 2);
    assert.equal((await one('select service_webhook_finish($1,204,2) r', [again[0].id])).r, true); ok();
    await c.query('RESET ROLE'); assert.equal((await one('select status from demo_webhook_events where id=$1', [again[0].id])).status, 'delivered'); ok();
    for (const who of [null, A] as const) { await as(who); await rejects('select service_webhook_claim(null,null,1)', [], /permission denied/); }

    // 060: chat API conversations.
    const chatTok = 'ap_ro_' + 'c'.repeat(64), mcpTok = 'ap_ro_' + 'm'.repeat(64);
    await as(A); await rejects("select create_readonly_token('mcp',$1,'mcp:read',2)", [sha(mcpTok)], /Upgrade required: the MCP server/); // Growth has no MCP
    await as('service'); await one("select public.set_manual_plan($1,'scale')", [A]); await as(A);
    await one("select create_readonly_token('chat',$1,'chat:write',2)", [sha(chatTok)]); ok();
    await one("select create_readonly_token('mcp',$1,'mcp:read',2)", [sha(mcpTok)]);
    await as('service');
    const conv = randomUUID() + randomUUID();
    const opened = (await one('select api_open_conversation($1,$2) v', [sha(chatTok), sha(conv)])).v;
    assert.ok(opened.id); ok();
    await c.query('RESET ROLE');
    const cs = await one('select source,fictional,order_label,user_id from support_cases where token_hash=$1', [sha(conv)]);
    assert.deepEqual([cs.source, cs.fictional, cs.order_label, cs.user_id], ['api', false, null, A]); ok();
    await as('service');
    assert.equal((await one('select api_conversation_ok($1,$2) v', [sha(chatTok), sha(conv)])).v, true); ok();
    assert.equal((await one('select api_conversation_ok($1,$2) v', [sha(chatTok), sha(caseTok)])).v, false, 'widget case is not an API conversation'); ok();
    assert.equal((await one('select api_open_conversation($1,$2) v', [sha(mcpTok), sha(randomUUID())])).v, null, 'wrong scope'); ok();
    await one("select public.set_manual_plan($1,'starter')", [A]);
    assert.equal((await one('select api_open_conversation($1,$2) v', [sha(chatTok), sha(randomUUID())])).v, null, 'plan without API'); assert.equal((await one('select api_conversation_ok($1,$2) v', [sha(chatTok), sha(conv)])).v, false); ok();
    await as(A); await rejects("select create_readonly_token('chat2',$1,'chat:write',2)", [sha('x' + randomUUID())], /Upgrade required: API access/);
    await as('service'); await one("select public.set_manual_plan($1,'growth')", [A]);

    // 061: Slack settings.
    await as(managerA, A); await rejects('select set_slack_settings($1,true)', [SLACK], /Insufficient role/);
    assert.equal((await one('select my_slack_settings() s')).s, null, 'managers cannot read'); ok();
    await as(A);
    await rejects('select set_slack_settings($1,true)', ['https://evil.example/services/a/b/cccccccccc'], /violates check/);
    assert.equal((await one('select set_slack_settings($1,true) r', [SLACK])).r, true);
    const ms = (await one('select my_slack_settings() s')).s;
    assert.deepEqual([ms.configured, ms.enabled, ms.hint, ms.planAllows], [true, true, '6789', true]); assert.ok(!JSON.stringify(ms).includes('hooks.slack.com')); ok();
    await rejects('select * from slack_settings', [], /permission denied/);
    await as('service');
    assert.equal((await one('select service_slack_target($1) t', [sha(caseTok)])).t.url, SLACK); ok();
    await one("select public.set_manual_plan($1,'starter')", [A]);
    assert.equal((await one('select service_slack_target($1) t', [sha(caseTok)])).t, null, 'plan without integrations'); ok();
    await as(A); await rejects('select set_slack_settings($1,true)', [SLACK], /Upgrade required/);
    assert.equal((await one('select set_slack_settings(null,false) r')).r, true); assert.equal((await one('select my_slack_settings() s')).s.configured, false); ok();
    console.log(`PASS phase 3 DB (058-061): ${n} checks; deep tier paid-only with weight 10 and weighted monthly allowance, plan-gated service webhook delivery with retries and stale-finish protection, chat API conversations (scope, plan, workspace), Slack settings (admin-only, plan-gated, URL never readable). Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
