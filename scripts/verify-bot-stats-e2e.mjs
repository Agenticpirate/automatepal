// End to end: Overview, conversation ratings, Tickets and Chat history narrowed by bot (?bot=, db/062) against a LOCAL app and the LOCAL
// Supabase with a real local auth user. Conversations without a bot belong to the Main bot. Usage:
//   E2E_APP=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=… SERVICE_ROLE_KEY=… \
//   LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/verify-bot-stats-e2e.mjs
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import pg from 'pg';
const {E2E_APP: APP, SUPABASE_URL: SB, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE, LOCAL_DATABASE_URL: DB} = process.env;
if (!APP || !SB || !ANON || !SERVICE || !DB) { console.error('Set E2E_APP, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY, LOCAL_DATABASE_URL.'); process.exit(1); }
for (const u of [APP, SB, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
let n = 0;
const ok = () => { n++; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const db = new pg.Client({connectionString: DB});
await db.connect();
async function user(email) {
  const u = await (await fetch(`${SB}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123', email_confirm: true})})).json();
  const t = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: ANON, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123'})})).json();
  return {id: u.id, token: t.access_token};
}
const tag = randomUUID().slice(0, 8);
const A = await user(`stats-a-${tag}@bot-stats.example.test`), B = await user(`stats-b-${tag}@bot-stats.example.test`);
const get = (who, path) => fetch(APP + path, {headers: {Authorization: `Bearer ${who.token}`}}).then(async r => ({status: r.status, body: await r.json()}));
try {
  await db.query("select public.set_manual_plan($1,'growth')", [A.id]);
  const docsBot = (await db.query("insert into bots(workspace_id,name) values($1,'Docs bot') returning id", [A.id])).rows[0].id;
  await db.query("insert into bots(id,workspace_id,name) values($1,$1,'Main bot') on conflict do nothing", [A.id]);
  // Main bot: 2 conversations (one with no bot_id, one explicit); Docs bot: 1; each with questions and a request.
  const mk = async (bot, label) => { const id = randomUUID(); await db.query("insert into support_cases(id,user_id,bot_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,$4,now()+interval '1 day',$5,19)", [id, A.id, bot, sha(randomUUID()), label]); return id; };
  const m1 = await mk(null, 'Main one'), m2 = await mk(A.id, 'Main two'), d1 = await mk(docsBot, 'Docs one');
  for (const [c, q] of [[m1, 'Main question one'], [m1, 'Main question two'], [m2, 'Main question three'], [d1, 'Docs question one']]) await db.query('insert into knowledge_interactions(user_id,case_id,question,supported,source_count) values($1,$2,$3,true,1)', [A.id, c, q]);
  for (const c of [m1, d1]) await db.query("insert into support_requests(case_id,user_id,kind,message) values($1,$2,'human_handoff','Please call me back about this.')", [c, A.id]);
  // Conversation ratings (db/065): Main 4, Docs 2.
  await db.query('insert into case_ratings(case_id,user_id,score) values($1,$3,4),($2,$3,2)', [m1, d1, A.id]);
  // Overview.
  let all = await get(A, '/api/owner-overview'), main = await get(A, `/api/owner-overview?bot=${A.id}`), docs = await get(A, `/api/owner-overview?bot=${docsBot}`);
  assert.equal(all.status, 200, JSON.stringify(all.body).slice(0, 200));
  assert.deepEqual([all.body.tickets.length, all.body.queries.length, all.body.requests.length], [3, 4, 2], 'all bots'); ok();
  assert.deepEqual([main.body.tickets.length, main.body.queries.length, main.body.requests.length], [2, 3, 1], 'Main bot includes conversations without a bot'); ok();
  assert.deepEqual([docs.body.tickets.length, docs.body.queries.length, docs.body.requests.length], [1, 1, 1], 'Docs bot'); ok();
  assert.deepEqual(docs.body.queries.map(q => q.question), ['Docs question one']); ok();
  assert.deepEqual([all.body.ratings.length, main.body.ratings.map(r => r.score), docs.body.ratings.map(r => r.score)], [2, [4], [2]], 'ratings by bot'); ok();
  // Tickets.
  assert.equal((await get(A, '/api/tickets')).body.tickets.length, 3);
  assert.deepEqual((await get(A, `/api/tickets?bot=${docsBot}`)).body.tickets.map(t => t.order_label), ['Docs one']);
  assert.equal((await get(A, `/api/tickets?bot=${A.id}`)).body.tickets.length, 2); ok();
  // Chat history.
  const h = await get(A, `/api/history?bot=${docsBot}`);
  assert.equal(h.status, 200, JSON.stringify(h.body).slice(0, 200)); assert.equal(h.body.conversations.length, 1); assert.equal(h.body.conversations[0].rating, 2, 'rating shown in chat history'); assert.equal((await get(A, '/api/history')).body.conversations.length, 3); ok();
  // Another workspace naming A's bot sees nothing of A's (RLS); an invalid value means all of their own.
  const bView = await get(B, `/api/tickets?bot=${docsBot}`); assert.equal(bView.body.tickets.length, 0); ok();
  assert.equal((await get(A, '/api/tickets?bot=not-a-uuid')).body.tickets.length, 3); ok();
  console.log(`PASS bot stats end to end: ${n} checks; Overview tickets/questions/requests/conversation ratings, Tickets and Chat history (with rating) narrowed to the Main bot (including conversations without a bot) or another bot, all bots by default, other workspaces see nothing, invalid filter ignored.`);
} finally {
  for (const u of [A, B]) await fetch(`${SB}/auth/v1/admin/users/${u.id}`, {method: 'DELETE', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`}}).catch(() => {});
  await db.end();
}
