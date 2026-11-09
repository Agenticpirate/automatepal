// db/062 multiple bots: plan limit, names, rename/delete (Main bot protected), per-bot settings rows (no
// foreign bot, no moving), per-bot install keys and conversations, the visitor view per bot, knowledge and
// exact answers limited to bots, per-bot answer model, workspace isolation. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-bots-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-bots-db: refusing non-local host'); process.exit(1); }
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
const K1 = 'pk_live_' + 'M'.repeat(23) + '1', K2 = 'pk_live_' + 'D'.repeat(23) + '2';
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@bots.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [A, agentA]);
    // Plan limit: Free has 1 bot (the Main bot).
    await as(A);
    await rejects("select create_bot('Docs bot')", [], /Upgrade required/);
    assert.equal((await one('select count(*)::int n from bots')).n, 0, 'a refused create leaves nothing behind'); ok();
    await as('service'); await one("select public.set_manual_plan($1,'growth')", [A]);
    await as(agentA, A); await rejects("select create_bot('Docs bot')", [], /Manager role required/);
    await as(A);
    const docsBot = (await one("select create_bot('Docs bot') id")).id as string;
    await rejects("select create_bot('Third')", [], /Upgrade required/); // Growth: 2
    await as('service'); await one("select public.set_manual_plan($1,'scale')", [A]); await as(A);
    await rejects("select create_bot('Docs bot')", [], /duplicate|unique/);
    assert.equal((await one("select rename_bot($1,'Help center bot') r", [docsBot])).r, true);
    assert.equal((await one("select rename_bot($1,'Shop bot') r", [A])).r, true, 'Main bot renamable'); ok();
    await rejects('select delete_bot($1)', [A], /Main bot cannot be deleted/);
    // Per-bot settings rows.
    await c.query("insert into widget_settings(user_id,label) values($1,'Shop help')", [A]);
    await c.query("insert into widget_settings(user_id,bot_id,label,controls) values($1,$2,'Docs help','{\"modelTier\":\"deep\",\"maxQuestions\":5}')", [A, docsBot]);
    assert.equal((await one('select count(*)::int n from widget_settings where user_id=$1', [A])).n, 2); ok();
    await as(B); await rejects("insert into widget_settings(user_id,bot_id,label) values($1,$2,'Steal')", [B, docsBot], /Unknown bot|row-level/);
    await as(A); await rejects('update widget_settings set bot_id=$1 where bot_id=$2', [A, docsBot], /cannot move|duplicate/);
    // Per-bot keys and conversations.
    await one('select rotate_widget_key($1)', [K1]); await one('select rotate_widget_key($1,$2)', [K2, docsBot]);
    await as(B); await rejects('select rotate_widget_key($1,$2)', ['pk_live_' + 'Z'.repeat(24), docsBot], /Unknown bot/);
    await as('service');
    const t1 = randomUUID() + randomUUID(), t2 = randomUUID() + randomUUID();
    await one('select widget_open_session($1,$2)', [K1, sha(t1)]); await one('select widget_open_session($1,$2)', [K2, sha(t2)]);
    await c.query('RESET ROLE');
    assert.equal((await one('select bot_id from support_cases where token_hash=$1', [sha(t2)])).bot_id, docsBot); assert.equal((await one('select bot_id from support_cases where token_hash=$1', [sha(t1)])).bot_id, A); ok();
    await as(null);
    const v1 = (await one('select support_case_view($1) v', [sha(t1)])).v, v2 = (await one('select support_case_view($1) v', [sha(t2)])).v;
    assert.deepEqual([v1.branding.label, v1.botId, v1.modelTier], ['Shop help', A, 'fast']); assert.deepEqual([v2.branding.label, v2.botId, v2.modelTier], ['Docs help', docsBot, 'deep']); ok();
    // Knowledge limited to a bot.
    await c.query('RESET ROLE');
    const docId = randomUUID(), docAll = randomUUID();
    await c.query("insert into knowledge_documents(id,user_id,title,content,published) values($1,$2,'API rate limits','The API allows 600 requests per minute per key for every plan.',true),($3,$2,'Shipping times','Orders ship within two working days and tracking arrives by email.',true)", [docId, A, docAll]);
    await c.query("insert into custom_responses(user_id,question,answer,published,bot_ids) values($1,'What is the API limit?','600 requests per minute per key.',true,$2)", [A, [docsBot]]);
    await as(A); assert.equal((await one("select set_knowledge_bots('source',$1,$2) r", [docId, [docsBot]])).r, true);
    await rejects("select set_knowledge_bots('source',$1,$2)", [docId, [randomUUID()]], /Unknown bot/);
    await as(B); assert.equal((await one("select set_knowledge_bots('source',$1,null) r", [docId])).r, false, 'other workspace cannot change it'); ok();
    await as(null);
    const search = async (tok: string, q: string) => ((await one('select support_knowledge_search($1,$2) r', [sha(tok), q])).r as {id: string}[]).map(x => x.id);
    assert.ok(!(await search(t1, 'API requests minute')).includes(docId), 'Main bot does not see the docs-only source');
    assert.ok((await search(t2, 'API requests minute')).includes(docId), 'Docs bot sees it'); ok();
    assert.ok((await search(t1, 'orders ship tracking')).includes(docAll) && (await search(t2, 'orders ship tracking')).includes(docAll), 'unscoped source: every bot'); ok();
    assert.equal((await one('select support_custom_response($1,$2) r', [sha(t1), 'What is the API limit?'])).r, null);
    assert.equal((await one('select support_custom_response($1,$2) r', [sha(t2), 'What is the API limit?'])).r.answer, '600 requests per minute per key.'); ok();
    // Per-bot question cap (Docs bot maxQuestions 5) uses that bot's settings.
    for (let i = 0; i < 5; i++) await one('select support_reserve_knowledge($1,$2)', [sha(t2), 'Question number ' + i]);
    await rejects('select support_reserve_knowledge($1,$2)', [sha(t2), 'One more'], /Conversation question limit reached/);
    // Deleting a bot: its conversations move to the Main bot, scoped knowledge becomes unscoped, key stops.
    await as(A); assert.equal((await one('select delete_bot($1) r', [docsBot])).r, true);
    await c.query('RESET ROLE');
    assert.equal((await one('select bot_id from support_cases where token_hash=$1', [sha(t2)])).bot_id, null);
    assert.equal((await one('select bot_ids from knowledge_documents where id=$1', [docId])).bot_ids, null); ok();
    await as('service'); assert.equal((await one('select widget_key_view($1) v', [K2])).v, null, 'deleted bot key stops'); ok();
    // Isolation: B sees none of A's bots.
    await as(B); assert.equal((await one('select count(*)::int n from bots')).n, 0); ok();
    await as(agentA, A); assert.equal((await one('select count(*)::int n from bots')).n, 1, 'agents can read'); ok();
    console.log(`PASS bots DB (062): ${n} checks; plan bot limit, unique names, rename, Main bot protected, per-bot settings (no foreign bot, no moving), per-bot keys and conversations, per-bot visitor view and model, knowledge and exact answers limited to bots, per-bot question cap, delete moves conversations and frees knowledge, isolation. Rolled back.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
