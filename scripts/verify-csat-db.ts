// db/065: CSAT. A visitor rates a conversation 1 to 5 by its token hash; one rating per conversation, replaced
// on re-rating; empty, expired or unknown conversations and bad scores refused; workspace members read their
// own ratings only and nobody writes the table directly. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-csat-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-csat-db: refusing non-local host'); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
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
const rate = async (tok: string, score: number | null) => (await one('select support_rate_case($1,$2::smallint) r', [sha(tok), score])).r;
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), agentA = randomUUID(), outsider = randomUUID();
    for (const u of [A, B, agentA, outsider]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@csat.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')", [A, agentA]);
    const mk = async (ws: string, expires = '1 hour') => { const id = randomUUID(), tok = randomUUID() + randomUUID(); await c.query(`insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '${expires}','CSAT fixture',19)`, [id, ws, sha(tok)]); return {id, tok}; };
    const a1 = await mk(A), aEmpty = await mk(A), aOld = await mk(A, '-1 minute'), aReq = await mk(A), b1 = await mk(B);
    for (const x of [a1, aOld, b1]) await c.query('insert into knowledge_interactions(user_id,case_id,question,supported,source_count) values((select user_id from support_cases where id=$1),$1,$2,true,1)', [x.id, 'A question']);
    await c.query("insert into support_requests(case_id,user_id,kind,message) values($1,$2,'human_handoff','Please call me back about this.')", [aReq.id, A]);
    // Visitor (anon) rates by token.
    await as(null);
    assert.equal(await rate(a1.tok, 4), true); ok();
    assert.equal(await rate(aReq.tok, 2), true, 'a request counts as a conversation'); ok();
    assert.equal(await rate(aEmpty.tok, 5), false, 'empty conversation'); assert.equal(await rate(aOld.tok, 5), false, 'expired link'); assert.equal(await rate('unknown', 5), false); ok();
    for (const bad of [0, 6, -1, null]) assert.equal(await rate(a1.tok, bad), false, 'score ' + bad); ok();
    assert.equal(await rate(b1.tok, 1), true);
    // Re-rating replaces; still one row.
    assert.equal(await rate(a1.tok, 5), true);
    await rejects('select * from case_ratings', [], /permission denied/);
    await rejects('insert into case_ratings(case_id,user_id,score) values($1,$2,5)', [aEmpty.id, A], /permission denied/);
    await c.query('RESET ROLE');
    assert.deepEqual((await c.query('select score from case_ratings where case_id=$1', [a1.id])).rows, [{score: 5}]); ok();
    // Workspace members read their own workspace's ratings only; nobody writes directly.
    await as(A); assert.deepEqual((await c.query('select case_id,score from case_ratings order by score')).rows, [{case_id: aReq.id, score: 2}, {case_id: a1.id, score: 5}]); ok();
    await as(agentA, A); assert.equal((await c.query('select 1 from case_ratings')).rowCount, 2); ok();
    await as(B); assert.deepEqual((await c.query('select score from case_ratings')).rows, [{score: 1}]); ok();
    await as(outsider, A); assert.equal((await c.query('select 1 from case_ratings')).rowCount, 0, 'non-member naming A sees nothing'); ok();
    await as(A);
    await rejects('insert into case_ratings(case_id,user_id,score) values($1,$2,5)', [aEmpty.id, A], /permission denied/);
    await rejects('update case_ratings set score=1 where case_id=$1', [a1.id], /permission denied/);
    await rejects('delete from case_ratings where case_id=$1', [a1.id], /permission denied/);
    // Deleting the conversation deletes its rating.
    await c.query('RESET ROLE'); await c.query('delete from support_cases where id=$1', [a1.id]);
    assert.equal((await c.query('select 1 from case_ratings where case_id=$1', [a1.id])).rowCount, 0); ok();
    console.log(`PASS CSAT DB (065): ${n} checks; visitor rates by token (1 to 5), empty/expired/unknown conversations and bad scores refused, re-rating replaces, members read their own workspace only, no direct writes, rating deleted with its conversation.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
