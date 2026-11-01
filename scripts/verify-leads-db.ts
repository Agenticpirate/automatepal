// Leads (047 delete_lead): workspace isolation of consented lead emails, manager-or-higher deletion that clears
// the address and consent but keeps the request, audit, and refusal for agents, other workspaces, non-members
// and anon. Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-leads-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-leads-db: refusing non-local database host ${host}`); process.exit(1); }
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
const leads = async () => (await c.query("select id,contact_email from support_requests where contact_consent and contact_email is not null order by contact_email")).rows as {id: string; contact_email: string}[];
const del = async (id: string) => (await one('select delete_lead($1) r', [id])).r as boolean;
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), managerA = randomUUID(), adminA = randomUUID(), agentA = randomUUID(), outsider = randomUUID();
    for (const u of [A, B, managerA, adminA, agentA, outsider]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@leads.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'manager'),($1,$3,'admin'),($1,$4,'agent')", [A, managerA, adminA, agentA]);
    const mkCase = async (ws: string) => { const id = randomUUID(); await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Leads fixture',19)", [id, ws, sha(randomUUID())]); return id; };
    const caseA = await mkCase(A), caseB = await mkCase(B);
    const mkReq = async (ws: string, caseId: string, email: string | null) => (await one("insert into support_requests(case_id,user_id,kind,message,contact_email,contact_consent) values($1,$2,'lead_callback','Fictional demo: please follow up.',$3,$4) returning id", [caseId, ws, email, email !== null])).id as string;
    const a1 = await mkReq(A, caseA, '=cmd@a.example'), a2 = await mkReq(A, caseA, 'second@a.example'), aNone = await mkReq(A, caseA, null);
    const b1 = await mkReq(B, caseB, 'buyer@b.example');
    // Listing: each workspace sees only its own consented leads; agents can read requests (existing 043 rule).
    await as(managerA, A);
    assert.deepEqual((await leads()).map((r) => r.contact_email), ['=cmd@a.example', 'second@a.example'], 'manager of A sees A leads only'); ok();
    await as(A);
    assert.deepEqual((await leads()).map((r) => r.id).sort(), [a1, a2].sort(), 'owner of A sees A leads only'); ok();
    await as(B);
    assert.deepEqual((await leads()).map((r) => r.id), [b1], 'B sees B only'); ok();
    await as(outsider, A);
    assert.deepEqual(await leads(), [], 'non-member acting as A sees nothing'); ok();
    await as(null);
    await rejects('select count(*) from support_requests', [], /permission denied/);
    // Deletion: manager and up, acting workspace only.
    await as(agentA, A);
    await rejects('select delete_lead($1)', [a1], /Insufficient role/);
    await as(outsider, A);
    await rejects('select delete_lead($1)', [a1], /Insufficient role/);
    await as(null);
    await rejects('select delete_lead($1)', [a1], /permission denied/);
    await as(B);
    assert.equal(await del(a1), false, 'B cannot delete an A lead'); ok();
    await as(managerA, A);
    assert.equal(await del(b1), false, 'A manager cannot delete a B lead'); ok();
    assert.equal(await del(aNone), false, 'a request without an email is not a lead'); ok();
    await rejects("update support_requests set contact_email=null where id=$1", [a2], /permission denied/);
    assert.equal(await del(a1), true); ok();
    assert.equal(await del(a1), false, 'second delete is a no-op'); ok();
    await as(adminA, A);
    assert.equal(await del(a2), true, 'admin can delete'); ok();
    await c.query('RESET ROLE');
    assert.deepEqual(await one('select contact_email,contact_consent,message,kind from support_requests where id=$1', [a1]), {contact_email: null, contact_consent: false, message: 'Fictional demo: please follow up.', kind: 'lead_callback'}, 'address and consent removed, request kept'); ok();
    assert.equal((await one('select contact_email from support_requests where id=$1', [b1])).contact_email, 'buyer@b.example', 'B untouched'); ok();
    const audit = (await c.query("select actor_id from owner_audit_events where user_id=$1 and resource='support_requests' and operation='UPDATE' and resource_id = any($2) order by created_at", [A, [a1, a2]])).rows.map((r) => r.actor_id);
    assert.deepEqual(audit, [managerA, adminA], 'deletions audited with the actor'); ok();
    await as(managerA, A);
    assert.deepEqual(await leads(), [], 'no A leads left'); ok();
    console.log(`PASS leads DB: ${n} checks; consented leads isolated per workspace (owner, manager, B, non-member, anon), delete_lead manager-or-higher in the acting workspace only (agent, outsider, anon refused; cross-workspace and email-less rows are no-ops), address and consent cleared with the request kept, no direct UPDATE, deletions audited with the actor; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
