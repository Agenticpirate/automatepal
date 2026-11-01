// MCP server (046, 047): scope-to-tool matrix, revoked/expired tokens, workspace isolation, metadata-only reads,
// knowledge proposals that stay unpublished until approved, daily caps, call-log pruning and RLS, new token
// scopes, and preview-data deletion. 047: team replies into taken-over conversations only (no takeover, link
// expiry, 100-message cap, history without the text, token and owner recorded, audited), settings read/update
// limited to the MCP keys and validated in SQL, the update cap, and existing scopes gaining nothing. Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on
// 127.0.0.1/localhost and never falls back to the hosted pooler.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-mcp-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-mcp-db: refusing non-local database host ${host}`); process.exit(1); }
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
type R = {ok?: boolean; data?: Record<string, unknown>; refused?: boolean; budget?: boolean; invalid?: string; quota?: string; limit?: number} | null;
const read = (h: string, tool: string) => one('select mcp_read_data($1,$2) r', [h, tool]).then((x) => x.r as R);
const add = (h: string, title: string, content: string) => one('select mcp_add_knowledge_source($1,$2,$3) r', [h, title, content]).then((x) => x.r as R);
const ctx = (h: string, q: string) => one('select mcp_test_context($1,$2) r', [h, q]).then((x) => x.r as R);
const scopeOf = (h: string) => one('select mcp_token_scope($1) r', [h]).then((x) => x.r as string | null);
const reply = (h: string, caseId: string, body: string) => one('select mcp_reply_to_conversation($1,$2,$3) r', [h, caseId, body]).then((x) => x.r as R);
const readS = (h: string) => one('select mcp_read_settings($1) r', [h]).then((x) => x.r as R);
const updS = (h: string, v: unknown) => one('select mcp_update_settings($1,$2::jsonb) r', [h, JSON.stringify(v)]).then((x) => x.r as R);
const READS = ['knowledge_sources', 'tickets', 'unanswered', 'overview', 'billing_status'];
const MATRIX: Record<string, string[]> = {
  'mcp:read': ['knowledge_sources', 'tickets', 'unanswered', 'overview', 'billing_status'],
  'support:read': ['tickets', 'billing_status'],
  'analytics:read': ['overview'],
  'knowledge:write': ['knowledge_sources'],
  'bot:test': [],
  'health:read': [],
  'conversations:reply': ['tickets'],
  'settings:read': [],
  'settings:write': [],
};
const vec = (v: number) => `('['||array_to_string(array_fill(${v}::float8,ARRAY[768]),',')||']')::extensions.vector`;
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID(), managerA = randomUUID();
    for (const u of [A, B, agentA, managerA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@mcp.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent'),($1,$3,'manager')", [A, agentA, managerA]);
    // New scopes can be created through the owner RPC; unknown scopes are refused.
    const tok: Record<string, string> = {};
    const tid: Record<string, string> = {};
    await as(A);
    for (const s of ['mcp:read', 'knowledge:write', 'bot:test', 'conversations:reply', 'settings:write']) {
      tok[s] = sha(randomUUID());
      tid[s] = (await one('select create_readonly_token($1,$2,$3,2) id', ['MCP ' + s, tok[s], s])).id;
      assert.ok(tid[s]); ok();
    }
    await rejects('select create_readonly_token($1,$2,$3,2)', ['Bad', sha(randomUUID()), 'foo:write'], /Invalid token/);
    await as(agentA, A);
    await rejects('select create_readonly_token($1,$2,$3,2)', ['Agent', sha(randomUUID()), 'mcp:read'], /Insufficient role/);
    // Remaining fixtures as the database owner: older scopes, revoked, expired and workspace B tokens.
    await c.query('RESET ROLE');
    const mk = async (ws: string, scope: string, extra = '') => {
      const h = sha(randomUUID());
      const id = (await one(`insert into readonly_tokens(user_id,label,token_hash,scope,created_at,expires_at,revoked_at) values($1,'fixture',$2,$3,${extra || "now(),now()+interval '1 hour',null"}) returning id`, [ws, h, scope])).id;
      return {h, id: id as string};
    };
    for (const s of ['support:read', 'analytics:read', 'health:read', 'settings:read']) { const t = await mk(A, s); tok[s] = t.h; tid[s] = t.id; }
    const revoked = await mk(A, 'mcp:read', "now(),now()+interval '1 hour',now()");
    const expired = await mk(A, 'mcp:read', "now()-interval '2 hours',now()-interval '1 hour',null");
    const tokB = await mk(B, 'mcp:read');
    // Workspace data: A and B each get cases, interactions, sources, a custom answer and a billing connection.
    const mkCase = async (ws: string, label: string) => {
      const id = randomUUID();
      await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour',$4,19)", [id, ws, sha(randomUUID()), label]);
      return id;
    };
    const caseA1 = await mkCase(A, 'MCP fixture A1'), caseA2 = await mkCase(A, 'MCP fixture A2'), caseB = await mkCase(B, 'MCP fixture B');
    await c.query("update support_cases set inbox_state='taken_over',ticket_status='pending' where id=$1", [caseA2]);
    await c.query(`insert into knowledge_interactions(user_id,case_id,question,supported,source_count,created_at) values
      ($1,$2,'What are your opening hours?',true,1,now()),($1,$2,'Do you ship to Mars?',false,0,now()-interval '1 hour'),
      ($1,$2,'Very old unanswered question',false,0,now()-interval '8 days'),($3,$4,'B private unanswered question',false,0,now())`, [A, caseA1, B, caseB]);
    const docA = randomUUID(), docB = randomUUID(), privA = randomUUID();
    await c.query(`insert into knowledge_documents(id,user_id,title,content,published) values
      ($1,$2,'Shipping policy A','SECRET-A-CONTENT shipping takes three to five business days.',true),
      ($3,$2,'Private draft A','Private draft content that is not published yet.',false),
      ($4,$5,'Shipping policy B','SECRET-B-CONTENT shipping is not offered by workspace B.',true)`, [docA, A, privA, docB, B]);
    await c.query(`insert into knowledge_chunks(id,document_id,user_id,position,content,embedding) values
      (gen_random_uuid(),$1,$2,0,'SECRET-A-CONTENT shipping takes three to five business days.',${vec(0.1)}),
      (gen_random_uuid(),$3,$2,0,'Private draft content that is not published yet.',${vec(0.2)}),
      (gen_random_uuid(),$4,$5,0,'SECRET-B-CONTENT shipping is not offered by workspace B.',${vec(0.3)})`, [docA, A, privA, docB, B]);
    await c.query("insert into custom_responses(user_id,question,answer,published) values($1,'What are your opening hours?','We are open nine to five, Monday to Friday.',true),($2,'What are your opening hours?','B answer: never open.',true)", [A, B]);
    const conn = "insert into billing_connections(user_id,provider,mode,credential_ciphertext,key_id,server_proof_hash,key_hint,account_label) values($1,'paypal','test','v2.k1.CIPHERTEXT-MARKER.t.c','k1',$2,'HINT-MARKER','LABEL-MARKER')";
    await c.query(conn, [A, sha('proof-a')]);
    await c.query(conn, [B, sha('proof-b')]);
    await c.query("insert into billing_lookups(user_id,case_id,provider,mode,kind,outcome,created_at) values($1,$2,'paypal','test','verify','verified',now()),($1,$2,'paypal','test','verify','mismatch',now()),($1,$2,'paypal','test','verify','mismatch',now()),($1,$2,'paypal','test','verify','mismatch',now()-interval '2 days')", [A, caseA1]);

    // Token validation: scope lookup and NULL for revoked, expired, unknown and tool-less scopes.
    await as(null);
    for (const s of ['mcp:read', 'support:read', 'analytics:read', 'knowledge:write', 'bot:test', 'conversations:reply', 'settings:read', 'settings:write']) { assert.equal(await scopeOf(tok[s]), s); ok(); }
    assert.equal(await scopeOf(tok['health:read']), null, 'health:read has no MCP tools'); ok();
    for (const h of [revoked.h, expired.h, sha('unknown')]) {
      assert.equal(await scopeOf(h), null); ok();
      assert.equal(await reply(h, randomUUID(), 'Hello'), null); ok();
      assert.equal(await readS(h), null); ok();
      assert.equal(await updS(h, {visitorChoice: false}), null); ok();
      assert.equal(await read(h, 'tickets'), null); ok();
      assert.equal(await add(h, 'A title', 'Long enough proposal content here.'), null); ok();
      assert.equal(await ctx(h, 'What are your opening hours?'), null); ok();
    }
    // Scope matrix for every read tool.
    for (const [s, allowed] of Object.entries(MATRIX)) for (const t of READS) {
      const r = await read(tok[s], t);
      if (allowed.includes(t)) assert.equal(r?.ok, true, `${s} ${t} allowed`); else assert.deepEqual(r, {refused: true}, `${s} ${t} refused`);
      ok();
    }
    assert.deepEqual(await read(tok['mcp:read'], 'exec'), {refused: true}, 'unknown read tool refused'); ok();
    assert.deepEqual(await add(tok['mcp:read'], 'A title', 'Long enough proposal content here.'), {refused: true}); ok();
    assert.deepEqual(await ctx(tok['knowledge:write'], 'Any question here?'), {refused: true}); ok();
    // Read contents: A only, metadata only.
    const tickets = (await read(tok['mcp:read'], 'tickets'))!.data!.tickets as {id: string; inbox_state: string}[];
    assert.deepEqual(tickets.map((x) => x.id).sort(), [caseA1, caseA2].sort(), 'tickets: A only'); ok();
    assert.ok(!JSON.stringify(tickets).includes('token_hash'), 'no token hash'); ok();
    assert.deepEqual(((await read(tokB.h, 'tickets'))!.data!.tickets as {id: string}[]).map((x) => x.id), [caseB], 'B sees only B'); ok();
    const sources = (await read(tok['mcp:read'], 'knowledge_sources'))!.data!;
    const sj = JSON.stringify(sources);
    assert.equal((sources.sources as unknown[]).length, 2, 'A sources only'); ok();
    assert.ok(!sj.includes('SECRET-A-CONTENT') && !sj.includes('SECRET-B') && !sj.includes('"content"'), 'no source text'); ok();
    const un = (await read(tok['mcp:read'], 'unanswered'))!.data!.rows as {question: string; supported: boolean}[];
    assert.deepEqual(un.map((x) => x.question), ['Do you ship to Mars?'], 'unanswered: A, last 7 days, unsupported only'); ok();
    const ov = (await read(tok['analytics:read'], 'overview'))!.data! as {tickets: {total: number; takenOver: number}; questions: {last7Days: number; unanswered7Days: number}; knowledge: {sources: number; published: number}};
    assert.equal(ov.tickets.total, 2); assert.equal(ov.tickets.takenOver, 1); ok();
    assert.equal(ov.questions.last7Days, 2); assert.equal(ov.questions.unanswered7Days, 1); ok();
    assert.equal(ov.knowledge.sources, 2); assert.equal(ov.knowledge.published, 1); ok();
    const bs = (await read(tok['support:read'], 'billing_status'))!.data!;
    const bj = JSON.stringify(bs);
    assert.ok(!bj.includes('CIPHERTEXT-MARKER') && !bj.includes('HINT-MARKER') && !bj.includes('LABEL-MARKER') && !bj.includes('server_proof'), 'no ciphertext, hint, label or proof'); ok();
    const conns = bs.connections as {provider: string; mode: string; key_id: string; lookups24h: Record<string, number>}[];
    assert.equal(conns.length, 1); assert.equal(conns[0].provider, 'paypal'); assert.equal(conns[0].key_id, 'k1'); ok();
    assert.deepEqual(conns[0].lookups24h, {verified: 1, mismatch: 2}, '24 h counts by outcome'); ok();

    // Knowledge proposal: unpublished, pending, audited, no chunks; publishing raises until approved.
    const p = await add(tok['knowledge:write'], '  Returns via MCP  ', 'Returns are accepted within 30 days of delivery.');
    assert.equal(p?.ok, true); const pid = (p!.data as {id: string}).id; ok();
    await c.query('RESET ROLE');
    const row = await one('select title,published,pending_approval,proposed_by_token from knowledge_documents where id=$1', [pid]);
    assert.deepEqual(row, {title: 'Returns via MCP', published: false, pending_approval: true, proposed_by_token: tid['knowledge:write']}); ok();
    assert.equal(await count('select count(*)::int n from knowledge_chunks where document_id=$1', [pid]), 0, 'no chunks'); ok();
    assert.equal(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='knowledge_documents' and operation='INSERT' and resource_id=$2", [A, pid]), 1, 'audited'); ok();
    await rejects('update knowledge_documents set published=true where id=$1', [pid], /Approve the proposed source before publishing/);
    await rejects("insert into knowledge_documents(id,user_id,title,content,published,pending_approval) values(gen_random_uuid(),$1,'Bad insert','Published and pending at once.',true,true)", [A], /Approve the proposed source/);
    // Approval: manager role in the acting workspace; agent refused; B and anon cannot approve A's proposal.
    await as(agentA, A);
    await rejects('select approve_knowledge_proposal($1)', [pid], /Insufficient role/);
    await rejects('update knowledge_documents set pending_approval=false where id=$1', [pid], /permission denied/);
    await as(B);
    assert.equal((await one('select approve_knowledge_proposal($1) r', [pid])).r, false, 'B cannot approve A'); ok();
    await as(null);
    await rejects('select approve_knowledge_proposal($1)', [pid], /permission denied/);
    await as(managerA, A);
    assert.equal((await one('select approve_knowledge_proposal($1) r', [pid])).r, true); ok();
    assert.equal((await one('select approve_knowledge_proposal($1) r', [pid])).r, false, 'second approval is a no-op'); ok();
    await c.query('RESET ROLE');
    assert.deepEqual(await one('select published,pending_approval from knowledge_documents where id=$1', [pid]), {published: false, pending_approval: false}, 'approved but still unpublished'); ok();
    await c.query('update knowledge_documents set published=true where id=$1', [pid]); ok();
    assert.ok(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='knowledge_documents' and operation='UPDATE' and resource_id=$2", [A, pid]) >= 1, 'approval audited'); ok();
    // Validation errors are logged, never stored.
    await as(null);
    assert.ok((await add(tok['knowledge:write'], 'ab', 'Long enough proposal content here.'))?.invalid); ok();
    assert.ok((await add(tok['knowledge:write'], 'Fine title', 'short'))?.invalid); ok();
    assert.ok((await add(tok['knowledge:write'], 'Fine title', 'x'.repeat(20001)))?.invalid); ok();
    assert.ok((await ctx(tok['bot:test'], 'hi'))?.invalid); ok();

    // Test-question context: exact custom answer for A only, else A's published chunks only; no interactions.
    await c.query('RESET ROLE');
    const before = await count('select count(*)::int n from knowledge_interactions where user_id=$1', [A]);
    await as(null);
    const cu = (await ctx(tok['bot:test'], '  what are your OPENING hours? '))!.data! as {custom: {answer: string} | null; chunks: unknown[]};
    assert.equal(cu.custom?.answer, 'We are open nine to five, Monday to Friday.'); assert.deepEqual(cu.chunks, []); ok();
    const ch = (await ctx(tok['bot:test'], 'How long does shipping take?'))!.data! as {custom: null; chunks: {excerpt: string; embedding: string; title: string}[]};
    assert.equal(ch.custom, null); ok();
    assert.deepEqual(ch.chunks.map((x) => x.title), ['Shipping policy A'], 'published A chunks only (the approved proposal has no chunks yet)'); ok();
    assert.equal(JSON.parse(ch.chunks[0].embedding).length, 768, 'embedding as JSON text'); ok();
    assert.ok(!JSON.stringify(ch).includes('SECRET-B') && !JSON.stringify(ch).includes('Private draft'), 'no B or private chunks'); ok();
    await c.query('RESET ROLE');
    assert.equal(await count('select count(*)::int n from knowledge_interactions where user_id=$1', [A]), before, 'no interactions recorded'); ok();

    // Daily caps per workspace per UTC day: 10 proposals, 20 test questions.
    await as(null);
    for (let i = 2; i <= 10; i++) { assert.equal((await add(tok['knowledge:write'], 'Proposal ' + i, 'Proposal content number ' + i + ' for the cap test.'))?.ok, true); }
    ok();
    assert.deepEqual(await add(tok['knowledge:write'], 'Proposal 11', 'Proposal content number 11 for the cap test.'), {budget: true, limit: 10}); ok();
    for (let i = 3; i <= 20; i++) { assert.equal((await ctx(tok['bot:test'], 'Cap question number ' + i))?.ok, true); }
    ok();
    assert.deepEqual(await ctx(tok['bot:test'], 'Cap question number 21'), {budget: true, limit: 20}); ok();
    // Source quota: 30 sources per workspace (proposals count).
    await c.query('RESET ROLE');
    await c.query("delete from mcp_calls where user_id=$1 and tool='add_text_knowledge_source'", [A]);
    await c.query("insert into knowledge_documents(id,user_id,title,content) select gen_random_uuid(),$1,'Filler '||g,'Filler content for the quota test.' from generate_series(1,30-(select count(*) from knowledge_documents where user_id=$1)::int) g", [A]);
    await as(null);
    assert.ok((await add(tok['knowledge:write'], 'Over quota', 'This proposal would exceed the quota.'))?.quota, 'quota enforced'); ok();
    // Call log: outcomes recorded, metadata only, pruned to 500 per workspace without losing today's write rows.
    await c.query('RESET ROLE');
    const outcomes = (await c.query('select outcome,count(*)::int n from mcp_calls where user_id=$1 group by outcome', [A])).rows.map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['budget', 'error', 'ok', 'refused']); ok();
    await as(null);
    await c.query("select mcp_read_data($1,'tickets') from generate_series(1,560)", [tok['mcp:read']]);
    await c.query('RESET ROLE');
    const kept = await count("select count(*)::int n from mcp_calls where user_id=$1 and outcome='ok' and tool='ask_test_question'", [A]);
    assert.equal(kept, 20, 'today\'s test-question rows survive pruning'); ok();
    assert.ok(await count('select count(*)::int n from mcp_calls where user_id=$1', [A]) <= 520, 'pruned to 500 plus today\'s write rows'); ok();
    assert.deepEqual(await ctx(tok['bot:test'], 'Still capped after pruning?'), {budget: true, limit: 20}, 'cap holds after pruning'); ok();
    // RLS: admin+ of the workspace can read the log; agents, other workspaces and anon cannot.
    await as(A);
    assert.ok(await count('select count(*)::int n from mcp_calls') > 0); ok();
    await as(agentA, A);
    assert.equal(await count('select count(*)::int n from mcp_calls'), 0, 'agent sees none'); ok();
    await as(B);
    assert.equal(await count('select count(*)::int n from mcp_calls where user_id=$1', [A]), 0, 'B sees none of A'); ok();
    await rejects('insert into mcp_calls(user_id,token_id,tool,outcome) values($1,$2,$3,$4)', [B, tokB.id, 'x', 'ok'], /permission denied/);
    await as(null);
    await rejects('select * from mcp_calls', [], /permission denied/);
    await rejects('select public.mcp_log($1,$2,$3,$4)', [A, tid['mcp:read'], 'x', 'ok'], /permission denied/);
    // 047 reply_to_conversation: scope, workspace isolation, taken over only (no takeover), expiry, caps, history.
    await c.query('RESET ROLE');
    const caseA3 = await mkCase(A, 'MCP fixture A3 expired');
    await c.query("update support_cases set inbox_state='taken_over',expires_at=now()-interval '1 minute' where id=$1", [caseA3]);
    await as(null);
    for (const s of ['mcp:read', 'support:read', 'analytics:read', 'knowledge:write', 'bot:test', 'settings:read', 'settings:write']) {
      assert.deepEqual(await reply(tok[s], caseA2, 'Hello from the team'), {refused: true}, s + ' cannot reply'); ok();
    }
    const conv = tok['conversations:reply'];
    assert.match((await reply(conv, caseA1, 'Hello from the team'))?.invalid ?? '', /Take over this conversation in Tickets first/); ok();
    assert.match((await reply(conv, caseB, 'Hello from the team'))?.invalid ?? '', /not found/, 'B conversation unreachable'); ok();
    assert.match((await reply(conv, caseA3, 'Hello from the team'))?.invalid ?? '', /expired/); ok();
    assert.ok((await reply(conv, caseA2, '   '))?.invalid); ok();
    assert.ok((await reply(conv, caseA2, 'x'.repeat(1001)))?.invalid); ok();
    await c.query('RESET ROLE');
    assert.equal(await count('select count(*)::int n from support_messages where case_id = any($1)', [[caseA1, caseA2, caseA3, caseB]]), 0, 'nothing stored yet'); ok();
    assert.equal((await one('select inbox_state from support_cases where id=$1', [caseA1])).inbox_state, 'open', 'no automatic takeover'); ok();
    const eventsBefore = await count('select count(*)::int n from ticket_events where case_id=$1', [caseA2]);
    await as(null);
    const sent = await reply(conv, caseA2, '  REPLY-TEXT-MARKER your order ships tomorrow.  ');
    assert.equal(sent?.ok, true); const mid = (sent!.data as {id: string}).id; ok();
    await c.query('RESET ROLE');
    assert.deepEqual(await one('select user_id,author,body,actor_id,token_id from support_messages where id=$1', [mid]), {user_id: A, author: 'owner', body: 'REPLY-TEXT-MARKER your order ships tomorrow.', actor_id: A, token_id: tid['conversations:reply']}, 'token and owner recorded'); ok();
    const ev = (await c.query('select body,actor_id from ticket_events where case_id=$1 order by created_at desc', [caseA2])).rows;
    assert.equal(ev.length, eventsBefore + 1); assert.equal(ev[0].body, 'Owner replied in the widget via an MCP token'); assert.equal(ev[0].actor_id, A); ok();
    assert.ok(!JSON.stringify(ev).includes('REPLY-TEXT-MARKER'), 'history never has the text'); ok();
    assert.equal(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='support_messages' and operation='INSERT' and resource_id=$2", [A, mid]), 1, 'reply audited'); ok();
    assert.equal((await one('select inbox_state,first_reviewed_at is not null r from support_cases where id=$1', [caseA2])).inbox_state, 'taken_over'); ok();
    await c.query("insert into support_messages(user_id,case_id,author,body) select $1,$2,'visitor','filler '||g from generate_series(1,99) g", [A, caseA2]);
    await as(null);
    assert.ok((await reply(conv, caseA2, 'One more reply'))?.quota, '100 messages per conversation'); ok();
    // The reply token also lists tickets (A only), and nothing else.
    assert.equal((await read(conv, 'tickets'))?.ok, true); ok();
    for (const t of ['knowledge_sources', 'unanswered', 'overview', 'billing_status']) { assert.deepEqual(await read(conv, t), {refused: true}); ok(); }

    // 047 settings: read and update only the MCP keys, validated in SQL, isolated, audited and capped.
    for (const s of ['mcp:read', 'support:read', 'analytics:read', 'knowledge:write', 'bot:test', 'conversations:reply']) {
      assert.deepEqual(await readS(tok[s]), {refused: true}, s + ' cannot read settings'); ok();
      assert.deepEqual(await updS(tok[s], {visitorChoice: false}), {refused: true}, s + ' cannot update settings'); ok();
    }
    assert.deepEqual(await updS(tok['settings:read'], {visitorChoice: false}), {refused: true}, 'settings:read cannot update'); ok();
    assert.deepEqual((await readS(tok['settings:read']))?.data, {configured: false, visitorChoice: true, hideContact: false, workingHours: null}); ok();
    const sw = tok['settings:write'];
    const WH = {enabled: true, timezone: 'Asia/Kolkata', days: [{day: 1, start: '09:00', end: '17:00'}, {day: 5, start: '22:00', end: '02:00'}], awayMessage: 'Back at nine.'};
    for (const bad of [{}, [], 'x', {label: 'Hijacked'}, {visitorChoice: 'yes'}, {hideContact: 1}, {allowedOrigins: ['https://evil.example']},
      {workingHours: 'on'}, {workingHours: {...WH, timezone: undefined}}, {workingHours: {...WH, timezone: 'Nowhere/Zone'}}, {workingHours: {...WH, enabled: 'true'}},
      {workingHours: {...WH, days: [{day: 7, start: '09:00', end: '17:00'}]}}, {workingHours: {...WH, days: [{day: 1, start: '9:00', end: '17:00'}]}},
      {workingHours: {...WH, days: [{day: 1, start: '09:00', end: '24:00'}]}}, {workingHours: {...WH, days: [{day: 1, start: '09:00', end: '17:00', note: '<b>x</b>'}]}},
      {workingHours: {...WH, days: [5]}}, {workingHours: {...WH, days: Array.from({length: 15}, () => ({day: 1, start: '09:00', end: '17:00'}))}},
      {workingHours: {...WH, awayMessage: 'x'.repeat(301)}}, {workingHours: {...WH, script: 'alert(1)'}}]) {
      assert.ok((await updS(sw, bad))?.invalid, 'refused: ' + JSON.stringify(bad).slice(0, 80)); ok();
    }
    await c.query('RESET ROLE');
    assert.equal(await count('select count(*)::int n from widget_settings where user_id=$1', [A]), 0, 'nothing written for invalid input'); ok();
    await as(null);
    const up = await updS(sw, {visitorChoice: false, workingHours: WH});
    assert.equal(up?.ok, true); assert.deepEqual(up!.data, {configured: true, visitorChoice: false, hideContact: false, workingHours: WH}); ok();
    await c.query('RESET ROLE');
    assert.equal(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='widget_settings' and operation='INSERT' and actor_id=$1", [A]), 1, 'settings write audited'); ok();
    await c.query(`update widget_settings set label='Owner label',controls=controls||'{"allowedOrigins":["https://shop.example"],"autoOpen":true}'::jsonb where user_id=$1`, [A]);
    await as(null);
    assert.equal((await updS(sw, {hideContact: true}))?.ok, true); ok();
    await c.query('RESET ROLE');
    const wsRow = await one('select label,controls from widget_settings where user_id=$1', [A]);
    assert.equal(wsRow.label, 'Owner label', 'branding untouched'); ok();
    assert.deepEqual(wsRow.controls, {visitorChoice: false, hideContact: true, workingHours: WH, allowedOrigins: ['https://shop.example'], autoOpen: true}, 'only the given keys replaced'); ok();
    assert.equal(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='widget_settings' and operation='UPDATE' and actor_id=$1", [A]), 1); ok();
    await as(null);
    assert.deepEqual((await readS(tok['settings:read']))!.data, {configured: true, visitorChoice: false, hideContact: true, workingHours: WH}, 'read returns MCP keys only'); ok();
    // Workspace B: its own token changes only B.
    await c.query('RESET ROLE');
    const swB = await mk(B, 'settings:write');
    await as(null);
    assert.equal((await updS(swB.h, {visitorChoice: false}))?.ok, true); ok();
    await c.query('RESET ROLE');
    assert.deepEqual((await one('select controls from widget_settings where user_id=$1', [B])).controls, {visitorChoice: false}); ok();
    assert.equal((await one('select controls from widget_settings where user_id=$1', [A])).controls.hideContact, true, 'A unchanged by B'); ok();
    // Daily cap: 20 successful updates per workspace per UTC day, and read calls cannot prune the counted rows.
    await as(null);
    for (let i = 3; i <= 20; i++) assert.equal((await updS(sw, {visitorChoice: i % 2 === 0}))?.ok, true);
    ok();
    assert.deepEqual(await updS(sw, {visitorChoice: true}), {budget: true, limit: 20}); ok();
    await c.query("select mcp_read_data($1,'tickets') from generate_series(1,520)", [tok['mcp:read']]);
    assert.deepEqual(await updS(sw, {visitorChoice: true}), {budget: true, limit: 20}, 'cap holds after pruning'); ok();
    await rejects('select public.mcp_settings_problem($1::jsonb)', ['{}'], /permission denied/);
    await rejects('select public.mcp_audit($1,$2,$3,$4)', [A, 'x', 'INSERT', A], /permission denied/);
    // New scopes are created only through the admin RPC; an agent still cannot create them.
    await as(agentA, A);
    await rejects('select create_readonly_token($1,$2,$3,2)', ['Agent', sha(randomUUID()), 'conversations:reply'], /Insufficient role/);
    // Revoking a token cuts MCP access immediately.
    await as(A);
    assert.equal((await one('select revoke_readonly_token($1) r', [tid['mcp:read']])).r, true); ok();
    await as(null);
    assert.equal(await read(tok['mcp:read'], 'tickets'), null, 'revoked token refused'); ok();
    // Preview-data deletion clears A's call log and tokens, keeps B's.
    await as(A);
    assert.equal((await one("select delete_preview_data('DELETE MY PREVIEW DATA') r")).r, true); ok();
    await c.query('RESET ROLE');
    assert.equal(await count('select count(*)::int n from mcp_calls where user_id=$1', [A]), 0, 'A call log cleared'); ok();
    assert.equal(await count('select count(*)::int n from readonly_tokens where user_id=$1', [A]), 0, 'A tokens cleared'); ok();
    assert.ok(await count('select count(*)::int n from mcp_calls where user_id=$1', [B]) > 0, 'B call log kept'); ok();
    console.log(`PASS MCP DB: ${n} checks; scope matrix, revoked/expired/unknown tokens NULL, workspace isolation, metadata-only reads (no source text, ciphertext, hint or label), proposals unpublished + pending + audited, publish blocked until manager approval, daily caps 10/20 and source quota, call log outcomes + pruning keeps caps + admin-only RLS, new scopes created and foo:write refused; 047 replies only into taken-over unexpired conversations with no takeover, 100-message cap, history without text, token + owner recorded and audited, settings read/update limited to MCP keys with SQL validation, isolation, audit and the 20/day cap surviving pruning, existing scopes refused the new tools; preview deletion A-only; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
