// Billing support (044): column grants, roles, live confirmation, server proof, persisted limits,
// attempt caps, paused cases, refund-review linkage, disconnect, preview-data deletion. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost and never falls back to the hosted pooler.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-billing-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-billing-db: refusing non-local database host ${host}`); process.exit(1); }
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
  await assert.rejects(() => c.query(sql, args), (e: Error) => match.test(e.message));
  await c.query('ROLLBACK TO SAVEPOINT x');
  ok();
}
const one = async (sql: string, args: unknown[] = []) => (await c.query(sql, args)).rows[0];
const count = async (sql: string, args: unknown[] = []) => Number((await one(sql, args)).n);
const CT = 'v2.k1.aXZpdml2aXZpdml2.dGFndGFndGFndGFndGFn.Y2lwaGVydGV4dA';
const save = (p: string, mode: string, ph: string, confirm = false) =>
  c.query("select save_billing_connection($1,$2,$3,'k1',$4,'AYde…demo','Fixture',$5::jsonb,$6) id", [p, mode, CT, ph, '{}', confirm]);
const proof = 'f'.repeat(64), ph = sha(proof);
const reserve = (h: string, kind: string, p: string, intent: string | null, pr: string | null = proof) => one('select support_billing_reserve($1,$2,$3,$4,$5) r', [h, pr, kind, p, intent]).then((x) => x.r as {id: string | null; mode: string | null; refused: string | null});
const finish = (h: string, id: string, outcome: string, ref: string | null, scope: unknown, pr: string | null = proof) =>
  one("select support_billing_finish($1,$2,$3,$4,'order',$5,'COMPLETED',4900,'USD',$6::jsonb) r", [h, pr, id, outcome, ref, scope === null ? null : JSON.stringify(scope)]).then((x) => x.r as {ok: boolean; expiresAt: string | null});

async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), adminA = randomUUID(), agentA = randomUUID();
    for (const u of [A, B, adminA, agentA]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@billing.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'admin'),($1,$3,'agent')", [A, adminA, agentA]);
    const tok: Record<string, string> = {};
    const mkCase = async (ws: string, name: string) => {
      const id = randomUUID(); tok[name] = sha(randomUUID());
      await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Billing fixture',19)", [id, ws, tok[name]]);
      return id;
    };
    const caseA = await mkCase(A, 'A'), caseB = await mkCase(B, 'B'), caseR = await mkCase(A, 'R'), caseV = await mkCase(A, 'V'), caseT = await mkCase(A, 'T');

    // Connect: owner test mode; admin test only; agent never; live needs owner + confirmation.
    await as(A);
    assert.ok((await save('paypal', 'test', ph)).rows[0].id); ok();
    await as(agentA, A); await rejects("select save_billing_connection('stripe','test',$1,'k1',$2,'','',null,false)", [CT, ph], /Insufficient role/);
    await as(adminA, A);
    assert.ok((await save('dodo', 'test', ph)).rows[0].id); ok();
    await rejects("select save_billing_connection('stripe','live',$1,'k1',$2,'','',null,true)", [CT, ph], /explicit confirmation/);
    await as(A);
    await rejects("select save_billing_connection('stripe','live',$1,'k1',$2,'','',null,false)", [CT, ph], /explicit confirmation/);
    assert.ok((await save('stripe', 'live', ph, true)).rows[0].id); ok();
    const ev = await one("select count(*)::int n, count(*) filter (where actor_id=$1)::int mine from billing_connection_events where provider='stripe' and event='live_confirmed'", [A]);
    assert.equal(ev.n, 1); assert.equal(ev.mine, 1); ok();
    assert.ok((await one("select live_confirmed_at from billing_connections where provider='stripe'")).live_confirmed_at); ok();

    // Column grants: the ciphertext and proof hash are never readable by a signed-in client.
    await rejects('select * from billing_connections', [], /permission denied/);
    await rejects('select credential_ciphertext from billing_connections', [], /permission denied/);
    await rejects('select server_proof_hash from billing_connections', [], /permission denied/);
    assert.equal(await count('select count(*)::int n from (select id,provider,mode,key_hint from billing_connections) x'), 3); ok();
    // B sees nothing of A; agents see lookups but not connections.
    await as(B);
    assert.equal(await count('select count(*)::int n from (select id from billing_connections) x'), 0); ok();
    assert.equal(await count('select count(*)::int n from billing_connection_events'), 0); ok();
    await as(agentA, A);
    assert.equal(await count('select count(*)::int n from (select id from billing_connections) x'), 0); ok();
    // anon has no table access at all.
    await as(null);
    await rejects('select count(*) from billing_lookups', [], /permission denied/);
    await rejects('select count(*) from billing_verifications', [], /permission denied/);

    // Context: ciphertext only with the server proof. Secret RPC: wrong proof returns null.
    let ctx = (await one('select support_billing_context($1,null) r', [tok.A])).r;
    assert.deepEqual(ctx.connections, []); assert.equal(ctx.workspaceId, null); ok();
    ctx = (await one('select support_billing_context($1,$2) r', [tok.A, 'e'.repeat(64)])).r;
    assert.deepEqual(ctx.connections, []); ok();
    ctx = (await one('select support_billing_context($1,$2) r', [tok.A, proof])).r;
    assert.equal(ctx.connections.length, 3); assert.equal(ctx.workspaceId, A); assert.ok(ctx.connections.every((x: {ciphertext: string}) => x.ciphertext === CT)); ok();
    await as(A);
    assert.equal((await one("select billing_connection_secret('paypal',$1) r", ['wrong'])).r, null); ok();
    assert.equal((await one("select billing_connection_secret('paypal',$1) r", [proof])).r.ciphertext, CT); ok();
    await as(agentA, A); await rejects("select billing_connection_secret('paypal',$1)", [proof], /Insufficient role/);

    // Status for visitors: providers and modes only.
    await as(null);
    const st = (await one('select support_billing_status($1) r', [tok.A])).r;
    assert.deepEqual(st.providers.map((p: {provider: string}) => p.provider), ['dodo', 'paypal', 'stripe']); assert.equal(st.verified, null); ok();
    assert.equal((await one('select support_billing_status($1) r', [sha('nope')])).r, null); ok();

    // Verification: 30 minutes, sealed scope required, 5 failures lock out.
    const r = await reserve(tok.V, 'verify', 'paypal', null);
    assert.ok(r.id && r.mode === 'test' && r.refused === null); ok();
    await rejects("select support_billing_finish($1,$2,$3,'verified','order','…901E','COMPLETED',4900,'USD',null)", [tok.V, proof, r.id], /Sealed scope required/);
    for (let i = 0; i < 5; i++) { const x = await reserve(tok.V, 'verify', 'paypal', null); assert.ok(x.id); assert.equal((await finish(tok.V, x.id!, 'mismatch', null, null)).ok, true); }
    assert.equal((await reserve(tok.V, 'verify', 'paypal', null)).refused, 'too_many_attempts'); ok();
    await rejects("select support_billing_reserve($1,$2,'lookup','paypal','not_an_intent')", [tok.V, proof], /Invalid billing lookup/);
    assert.equal((await reserve(tok.V, 'verify', 'square', null)).refused, 'not_connected'); ok();

    // Forgery (anon key + case token only): without the server proof a visitor can neither create
    // nor settle a lookup, so no forged "verified"/"answered" row can back a refund-review ticket.
    const wrong = 'e'.repeat(64);
    for (const bad of [null, wrong]) {
      assert.deepEqual(await reserve(tok.R, 'verify', 'paypal', null, bad), {id: null, mode: null, refused: 'not_connected'});
      assert.deepEqual(await reserve(tok.R, 'lookup', 'paypal', 'order_status', bad), {id: null, mode: null, refused: 'not_connected'});
    }
    ok();
    const fv = await reserve(tok.R, 'verify', 'paypal', null), fl = await reserve(tok.R, 'lookup', 'paypal', 'order_status');
    assert.ok(fv.id && fl.id); ok();
    for (const bad of [null, wrong]) {
      assert.equal((await finish(tok.R, fv.id!, 'verified', '…901E', {sealed: 'v2.k1.x.y.z'}, bad)).ok, false);
      assert.equal((await finish(tok.R, fl.id!, 'answered', '…901E', null, bad)).ok, false);
    }
    ok();
    await rejects('select support_billing_refund_request($1,$2,$3)', [tok.R, fv.id, 'Please review my refund'], /Verified payment lookup required/);
    await rejects('select support_billing_refund_request($1,$2,$3)', [tok.R, fl.id, 'Please review my refund'], /Verified payment lookup required/);
    assert.equal((await one('select support_billing_status($1) r', [tok.R])).r.verified, null, 'no verification from a forged finish'); ok();
    await c.query('RESET ROLE');
    const forged = (await c.query('select outcome,record_ref,record_status,amount_minor from billing_lookups where id = any($1::uuid[]) order by kind', [[fv.id, fl.id]])).rows;
    assert.deepEqual(forged, [{outcome: 'pending', record_ref: null, record_status: null, amount_minor: null}, {outcome: 'pending', record_ref: null, record_status: null, amount_minor: null}]); ok();
    assert.equal(await count('select count(*)::int n from billing_verifications where case_id=$1', [caseR]), 0); ok();
    assert.equal(await count('select count(*)::int n from support_requests where case_id=$1', [caseR]), 0); ok();
    await as(null);

    // Refund review: needs a verified lookup with a record ref on the same case; sets pending; decision works.
    const vr = await reserve(tok.R, 'verify', 'paypal', null);
    const fin = await finish(tok.R, vr.id!, 'verified', '…901E', {sealed: 'v2.k1.x.y.z'});
    assert.ok(fin.ok && fin.expiresAt); ok();
    assert.ok(Date.parse(fin.expiresAt!) - Date.now() <= 30 * 60_000 + 5000); ok();
    assert.equal((await one('select support_billing_status($1) r', [tok.R])).r.verified.provider, 'paypal'); ok();
    const mm = await reserve(tok.R, 'verify', 'paypal', null); await finish(tok.R, mm.id!, 'mismatch', null, null);
    await rejects('select support_billing_refund_request($1,$2,$3)', [tok.R, mm.id, 'Please review my refund'], /Verified payment lookup required/);
    await rejects('select support_billing_refund_request($1,$2,$3)', [tok.A, vr.id, 'Please review my refund'], /Verified payment lookup required/);
    const req = (await one('select support_billing_refund_request($1,$2,$3) id', [tok.R, vr.id, 'Please review my refund'])).id;
    await c.query('RESET ROLE');
    const row = await one('select kind,billing_lookup_id from support_requests where id=$1', [req]);
    assert.equal(row.kind, 'refund_request'); assert.equal(row.billing_lookup_id, vr.id); ok();
    const cs = await one('select review_decision,category from support_cases where id=$1', [caseR]);
    assert.equal(cs.review_decision, 'pending'); assert.equal(cs.category, 'refund'); ok();
    await as(A);
    assert.equal((await one("select decide_ticket_review($1,'approved') r", [caseR])).r, true); ok();
    await as(agentA, A);
    assert.ok(await count('select count(*)::int n from billing_lookups where case_id=$1', [caseR]) >= 2, 'agent reads lookup metadata'); ok();

    // Paused case: lookups refused at reserve; a takeover during the call discards the finish.
    await as(null);
    const lt = await reserve(tok.T, 'lookup', 'paypal', 'order_status');
    assert.ok(lt.id); ok();
    await c.query('RESET ROLE'); await c.query("update support_cases set inbox_state='taken_over' where id=$1", [caseT]);
    await as(null);
    assert.equal((await finish(tok.T, lt.id!, 'answered', '…901E', null)).ok, false); ok();
    assert.equal((await reserve(tok.T, 'lookup', 'paypal', 'order_status')).refused, 'case_paused'); ok();
    await c.query('RESET ROLE');
    assert.equal((await one('select outcome from billing_lookups where id=$1', [lt.id])).outcome, 'refused'); ok();
    // One owner-audit row per reserve, metadata only.
    const lookupsA = await count('select count(*)::int n from billing_lookups where user_id=$1', [A]);
    assert.equal(await count("select count(*)::int n from owner_audit_events where user_id=$1 and resource='billing_lookups'", [A]), lookupsA); ok();

    // Persisted limits: provider 30 / 10 min trips at 31; workspace 60 / 10 min trips at 61.
    await c.query('SAVEPOINT limits');
    const L = await mkCase(A, 'L'); void L;
    const fill = async (p: string, k: number) => {
      for (let i = 0; i < k; i++) {
        const cid = await mkCase(A, `F${p}${i}`);
        await c.query("insert into billing_lookups(user_id,case_id,provider,mode,kind,intent,outcome) values($1,$2,$3,'test','lookup','order_status','answered')", [A, cid, p]);
      }
    };
    const already = await count("select count(*)::int n from billing_lookups where user_id=$1 and provider='paypal' and created_at>now()-interval '10 minutes'", [A]);
    await fill('paypal', 29 - already);
    await as(null);
    assert.ok((await reserve(tok.L, 'lookup', 'paypal', 'order_status')).id, '30th paypal lookup allowed'); ok();
    assert.equal((await reserve(tok.L, 'lookup', 'paypal', 'order_status')).refused, 'rate_limited', '31st paypal lookup refused'); ok();
    await c.query('RESET ROLE');
    const total = await count("select count(*)::int n from billing_lookups where user_id=$1 and created_at>now()-interval '10 minutes'", [A]);
    await fill('stripe', 60 - total);
    await as(null);
    assert.equal((await reserve(tok.L, 'lookup', 'dodo', 'order_status')).refused, 'rate_limited', '61st workspace lookup refused'); ok();
    await c.query('ROLLBACK TO SAVEPOINT limits');

    // Disconnect deletes the ciphertext row and keeps the event row.
    await as(A);
    assert.equal((await one("select delete_billing_connection('dodo') r")).r, true); ok();
    await c.query('RESET ROLE');
    assert.equal(await count("select count(*)::int n from billing_connections where user_id=$1 and provider='dodo'", [A]), 0); ok();
    assert.equal(await count("select count(*)::int n from billing_connection_events where user_id=$1 and provider='dodo' and event='disconnected'", [A]), 1); ok();

    // Workspace B keeps its data when A deletes preview data.
    await as(B); await save('paypal', 'test', ph);
    await as(null); const rb = await reserve(tok.B, 'verify', 'paypal', null); await finish(tok.B, rb.id!, 'mismatch', null, null);
    await as(A); assert.equal((await one("select delete_preview_data('DELETE MY PREVIEW DATA') r")).r, true); ok();
    await c.query('RESET ROLE');
    for (const t of ['billing_connections', 'billing_connection_events', 'billing_lookups', 'billing_verifications']) {
      assert.equal(await count(`select count(*)::int n from ${t} where user_id=$1`, [A]), 0, `${t} cleared for A`);
    }
    ok();
    assert.equal(await count('select count(*)::int n from billing_connections where user_id=$1', [B]), 1); assert.equal(await count('select count(*)::int n from billing_lookups where user_id=$1', [B]), 1); ok();
    void caseA; void caseB; void caseV;
    console.log(`PASS billing DB: ${n} checks; ciphertext column never granted, cross-tenant isolation, role matrix, owner-only live confirmation, server proof, verification + 5-attempt cap, refund-review linkage + decision, paused/in-flight suppression, audit per reserve, provider 30 and workspace 60 limits, disconnect keeps events, preview deletion; rollback only.`);
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
