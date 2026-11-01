// Owner replies in the widget (045): takeover/expiry gates, role matrix, cross-workspace refusal, visitor
// scoping, caps, ticket history without the reply text, preview-data deletion, and AI suppression kept.
// Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost and never falls back to
// the hosted pooler.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-owner-replies-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-owner-replies-db: refusing non-local database host ${host}`); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
let n = 0;
const ok = () => { n++; };
async function as(user: string | null, workspace?: string) {
  await c.query('RESET ROLE');
  await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
  await c.query("select set_config('request.headers',$1,true)", [JSON.stringify(workspace ? {'x-workspace-id': workspace} : {})]);
  await c.query(user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
}
async function rejects(sql: string, args: unknown[], match: RegExp) {
  await c.query('SAVEPOINT x');
  await assert.rejects(() => c.query(sql, args), (e: Error) => match.test(e.message) || (console.error('unexpected error:', e.message), false));
  await c.query('ROLLBACK TO SAVEPOINT x');
  ok();
}
const one = async (sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows[0];
const count = async (sql: string, args: unknown[] = []) => Number((await one(sql, args)).n);
const reply = (id: string, body: string) => one('select post_case_reply($1,$2) r', [id, body]).then((x) => x.r as string);
const visitor = (h: string, body: string) => one('select support_visitor_message($1,$2) r', [h, body]).then((x) => x.r as string);
const poll = (h: string, after: string | null = null) => one('select support_case_messages($1,$2::timestamptz) r', [h, after]).then((x) => x.r as {inboxState: string; messages: {id: string; author: string; body: string; created_at: string}[]} | null);

async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@replies.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [A, agentA]);
    const tok: Record<string, string> = {};
    const mkCase = async (ws: string, name: string, state = 'open', expires = "now()+interval '1 hour'") => {
      const id = randomUUID(); tok[name] = sha(randomUUID());
      await c.query(`insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount,inbox_state) values($1,$2,$3,${expires},'Replies fixture',19,$4)`, [id, ws, tok[name], state]);
      return id;
    };
    const caseA = await mkCase(A, 'A', 'taken_over'), caseOpen = await mkCase(A, 'O'), caseExp = await mkCase(A, 'E', 'taken_over', "now()+interval '1 second'"), caseB = await mkCase(B, 'B', 'taken_over'), caseCap = await mkCase(A, 'C', 'taken_over');
    await c.query("update support_cases set expires_at=now()-interval '1 minute' where id=$1", [caseExp]);

    // Owner replies: refused when not taken over and when expired; allowed for owner and agent.
    await as(A);
    await rejects('select post_case_reply($1,$2)', [caseOpen, 'Hello'], /Take over the conversation first/);
    await rejects('select post_case_reply($1,$2)', [caseExp, 'Hello'], /expired/);
    await rejects('select post_case_reply($1,$2)', [caseA, '   '], /Invalid reply/);
    await rejects('select post_case_reply($1,$2)', [caseA, 'x'.repeat(1001)], /Invalid reply/);
    const r1 = await reply(caseA, '  Hi, this is the owner.  '); assert.ok(r1); ok();
    assert.equal((await one('select body from support_messages where id=$1', [r1])).body, 'Hi, this is the owner.', 'trimmed'); ok();
    await as(agentA, A);
    const r2 = await reply(caseA, 'Agent here too.'); assert.ok(r2); ok();
    assert.equal((await one('select actor_id from support_messages where id=$1', [r2])).actor_id, agentA, 'actor stamped'); ok();
    // Workspace B cannot reply to A's case, and A's agent cannot reply to B's case.
    await as(B);
    await rejects('select post_case_reply($1,$2)', [caseA, 'Cross-tenant'], /Ticket unavailable/);
    await as(agentA, A);
    await rejects('select post_case_reply($1,$2)', [caseB, 'Cross-tenant'], /Ticket unavailable/);
    // Anon cannot call the owner RPC.
    await as(null);
    await rejects('select post_case_reply($1,$2)', [caseA, 'anon'], /permission denied/);
    // No direct table writes for signed-in clients; reads scoped to the workspace.
    await as(A);
    await rejects("insert into support_messages(user_id,case_id,author,body) values($1,$2,'owner','direct')", [A, caseA], /permission denied/);
    await rejects("update support_messages set body='edited' where case_id=$1", [caseA], /permission denied/);
    assert.equal(await count('select count(*)::int n from support_messages where case_id=$1', [caseA]), 2); ok();
    await as(B);
    assert.equal(await count('select count(*)::int n from support_messages where case_id=$1', [caseA]), 0, 'B sees none of A'); ok();
    await as(null);
    await rejects('select * from support_messages', [], /permission denied/);

    // Ticket history records the reply without its text; first review and updated time are stamped.
    await c.query('RESET ROLE');
    const ev = await one("select count(*)::int n, bool_and(body='Owner replied in the widget') same from ticket_events where case_id=$1 and kind='owner_update'", [caseA]);
    assert.equal(ev.n, 2); assert.equal(ev.same, true); ok();
    assert.equal(await count("select count(*)::int n from ticket_events where case_id=$1 and body like '%owner.%'", [caseA]), 0, 'reply body not copied'); ok();
    assert.ok((await one('select first_reviewed_at from support_cases where id=$1', [caseA])).first_reviewed_at); ok();
    assert.ok(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='support_messages'", [A]) >= 2, 'owner writes audited'); ok();

    // Visitor side: poll sees only its own case, cursor works, write refused when not taken over.
    await as(null);
    const pA = await poll(tok.A);
    assert.equal(pA?.inboxState, 'taken_over'); assert.deepEqual(pA?.messages.map((m) => m.author), ['owner', 'owner']); ok();
    assert.equal((await poll(tok.A, pA!.messages[1].created_at))?.messages.length, 0, 'cursor excludes seen'); ok();
    assert.equal((await poll(tok.A, pA!.messages[0].created_at))?.messages.length, 1, 'cursor returns newer'); ok();
    assert.equal((await poll(tok.B))?.messages.length, 0, 'B case has no A messages'); ok();
    assert.equal(await poll(tok.E), null, 'expired link returns null'); ok();
    assert.equal(await poll(sha('unknown')), null); ok();
    const v1 = await visitor(tok.A, 'Thanks, my order number is DEMO-1.'); assert.ok(v1); ok();
    assert.deepEqual((await poll(tok.A))?.messages.map((m) => m.author), ['owner', 'owner', 'visitor']); ok();
    await rejects('select support_visitor_message($1,$2)', [tok.O, 'Hello?'], /No person has joined/);
    await rejects('select support_visitor_message($1,$2)', [tok.E, 'Hello?'], /expired/);
    await rejects('select support_visitor_message($1,$2)', [tok.A, ''], /Invalid message/);
    await c.query('RESET ROLE');
    assert.equal((await one('select user_id from support_messages where id=$1', [v1])).user_id, A, 'visitor row in the case workspace'); ok();

    // Caps: 50 visitor messages per case, 100 messages per case.
    await c.query('SAVEPOINT caps');
    await c.query("insert into support_messages(user_id,case_id,author,body) select $1,$2,'visitor','m'||g from generate_series(1,50) g", [A, caseCap]);
    await as(null);
    await rejects('select support_visitor_message($1,$2)', [tok.C, 'one more'], /Message limit reached/);
    await c.query('RESET ROLE');
    await c.query("insert into support_messages(user_id,case_id,author,body) select $1,$2,'owner','o'||g from generate_series(1,50) g", [A, caseCap]);
    await as(A);
    await rejects('select post_case_reply($1,$2)', [caseCap, 'one more'], /Message limit reached/);
    await as(null);
    assert.equal((await poll(tok.C))?.messages.length, 100, 'poll returns latest 100'); ok();
    await c.query('ROLLBACK TO SAVEPOINT caps');

    // Takeover and in-flight suppression unchanged: AI reservation still raises on a taken-over case.
    await as(null);
    await rejects('select support_reserve_knowledge($1,$2)', [tok.A, 'What is the refund policy?'], /AI paused/);
    // Releasing the case closes the reply channel again.
    await as(A);
    assert.equal((await one("select set_support_inbox($1,'open') r", [caseA])).r, true); ok();
    await rejects('select post_case_reply($1,$2)', [caseA, 'After release'], /Take over the conversation first/);
    await as(null);
    assert.equal((await poll(tok.A))?.inboxState, 'open'); ok();
    await rejects('select support_visitor_message($1,$2)', [tok.A, 'Still there?'], /No person has joined/);

    // Preview-data deletion clears A's messages and keeps B's.
    await as(B); await reply(caseB, 'B owner reply');
    await as(A); assert.equal((await one("select delete_preview_data('DELETE MY PREVIEW DATA') r")).r, true); ok();
    await c.query('RESET ROLE');
    assert.equal(await count('select count(*)::int n from support_messages where user_id=$1', [A]), 0, 'A cleared'); ok();
    assert.equal(await count('select count(*)::int n from support_messages where user_id=$1', [B]), 1, 'B kept'); ok();
    console.log(`PASS owner replies DB: ${n} checks; takeover + expiry gates, owner/agent allowed, cross-workspace and anon refused, no direct writes, visitor poll scoped + cursor, visitor write only when taken over, 50/100 caps, history without reply text, audit, AI reservation still paused, preview deletion A-only; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
