// Phase 6 DB checks for 048-051 (email, server errors, transcripts and retention, scheduled refresh, insights,
// widget opens, delete_preview_data). Rollback only. LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import {Client} from 'pg';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-production-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
const host = new URL(local).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) { console.error(`verify-production-db: refusing non-local database host ${host}`); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
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
const val = async (sql: string, args: unknown[] = []) => Object.values((await one(sql, args)) ?? {})[0];
const H = sha('recipient@example.com');
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), adminA = randomUUID(), managerA = randomUUID(), agentA = randomUUID(), outsider = randomUUID();
    for (const u of [A, B, adminA, managerA, agentA, outsider]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@p6.example.test`]);
    await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'admin'),($1,$3,'manager'),($1,$4,'agent')", [A, adminA, managerA, agentA]);
    const mkCase = async (ws: string, token: string = randomUUID(), extra = '') => { const id = randomUUID(); await c.query('RESET ROLE'); await c.query(`insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount${extra ? ',created_at,ticket_updated_at' : ''}) values($1,$2,$3,now()+interval '1 hour','P6 fixture',19${extra ? ',$4,$4' : ''})`, extra ? [id, ws, sha(token), extra] : [id, ws, sha(token)]); return id; };

    // ---------- 048 email ----------
    await as(managerA, A);
    await rejects('select set_email_settings(false,true,true)', [], /Insufficient role/);
    await as(agentA, A);
    assert.equal((await c.query('select * from email_settings')).rowCount, 0); assert.equal((await c.query('select * from email_log')).rowCount, 0, 'agents cannot read the email log'); ok();
    await rejects("select email_reserve_member('team_invite',$1)", [H], /Insufficient role/);
    const vr = await val("select email_reserve_member('visitor_reply',$1)", [H]) as {id: string; allowed: boolean};
    assert.equal(vr.allowed, true, 'agents can reserve a visitor reply'); ok();
    assert.equal(await val("select email_finish_member($1,'sent','msg_1')", [vr.id]), true);
    assert.equal(await val("select email_finish_member($1,'sent','msg_2')", [vr.id]), false, 'a row is finished once'); ok();
    await rejects("select email_reserve_member('owner_alert',$1)", [H], /Invalid email reservation/);
    await rejects("select email_reserve_member('visitor_reply','not-a-hash')", [], /Invalid email reservation/);
    await rejects("select email_reserve($1,'owner_alert',$2)", [A, H], /permission denied/);
    await rejects("select email_finish($1,'sent',null)", [vr.id], /permission denied/);
    await rejects("select record_server_error($1,'/x','local')", [randomUUID()], /permission denied/);
    await rejects('select service_weekly_digest($1)', [A], /permission denied/);
    await rejects('select purge_expired_transcripts(10)', [], /permission denied/);
    await rejects('select service_refresh_claim(2)', [], /permission denied/);
    await rejects('select service_insights_pending(5)', [], /permission denied/);
    await as(B);
    assert.equal(await val("select email_finish_member($1,'failed',null)", [vr.id]), false, 'B cannot finish an A row'); ok();
    await as(managerA, A);
    const inv = await val("select email_reserve_member('team_invite',$1)", [H]) as {allowed: boolean};
    assert.equal(inv.allowed, true); ok();
    assert.deepEqual((await c.query('select email_type,status,provider_id from email_log order by created_at')).rows, [{email_type: 'visitor_reply', status: 'sent', provider_id: 'msg_1'}, {email_type: 'team_invite', status: 'reserved', provider_id: null}], 'managers read metadata only'); ok();
    await as(adminA, A);
    assert.equal(await val('select set_email_settings(false,true,true)'), true); ok();
    await as('service');
    const off = await val("select email_reserve($1,'owner_alert',$2)", [A, H]) as {allowed: boolean; status: string};
    assert.deepEqual([off.allowed, off.status], [false, 'suppressed_off'], 'turned-off alerts are logged, not sent'); ok();
    const statuses: string[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await val("select email_reserve($1,'new_lead',$2)", [A, H]) as {status: string}).status);
    assert.equal(statuses.filter((s) => s === 'reserved').length, 20); assert.deepEqual(statuses.slice(20), ['suppressed_cap', 'suppressed_cap'], 'new-lead cap 20 per day'); ok();
    const d1 = await val("select email_reserve($1,'weekly_digest',$2)", [A, H]) as {allowed: boolean};
    const d2 = await val("select email_reserve($1,'weekly_digest',$2)", [A, H]) as {status: string};
    assert.equal(d1.allowed, true); assert.equal(d2.status, 'suppressed_cap', 'one digest per 6 days'); ok();
    for (let i = 0; i < 80; i++) await c.query("select email_reserve($1,'visitor_reply',$2)", [B, H]);
    assert.equal(await val("select count(*)::int from email_log where user_id=$1 and status='reserved'", [B]), 50, 'visitor reply cap 50'); ok();
    await c.query('RESET ROLE');
    assert.ok(Number(await val("select count(*) from owner_audit_events where user_id=$1 and resource='email_log'", [A])) >= 24, 'every reservation is audited'); ok();
    assert.equal(await val("select actor_id from owner_audit_events where user_id=$1 and resource='email_log' order by created_at limit 1", [A]), agentA, 'member reservations record the person'); ok();
    assert.equal((await c.query("select column_name from information_schema.columns where table_name='email_log' and column_name in ('recipient','email','subject','body','text')")).rowCount, 0, 'no address or content columns'); ok();
    // Digest numbers and due list.
    const caseA = await mkCase(A, 'tokA');
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count,created_at) values($1,$2,'Do you ship to Pune?',false,0,now()-interval '1 day'),($1,$2,'do you  ship to pune?',false,0,now()-interval '2 days'),($1,$2,'Refund policy?',true,1,now()-interval '1 day'),($1,$2,'Old one',true,1,now()-interval '10 days')", [A, caseA]);
    await as('service');
    const dg = await val('select service_weekly_digest($1)', [A]) as {questions: number; questionsPrev: number; answered: number; answeredPrev: number; topUnanswered: {question: string; count: number}[]};
    assert.deepEqual([dg.questions, dg.questionsPrev, dg.answered, dg.answeredPrev], [3, 1, 1, 1]); assert.equal(dg.topUnanswered[0].count, 2, 'unanswered questions grouped case- and space-insensitively'); ok();
    const due = (await c.query('select * from service_digest_due(10)')).rows.map((r) => Object.values(r)[0]);
    assert.ok(!due.includes(A), 'A already has a digest this week'); ok();
    // Server errors.
    const req = randomUUID();
    assert.equal(await val("select record_server_error($1,'/api/support','abc123def456')", [req]), true);
    await rejects("select record_server_error($1,'/api/x?token=1','local')", [randomUUID()], /Invalid server error row/);
    assert.equal((await val('select server_error_summary(60)') as {groups: {route: string; count: number}[]}).groups.find((g) => g.route === '/api/support')?.count, 1); ok();
    await c.query('RESET ROLE');
    await rejects("insert into operational_events(user_id,request_id,code,severity,component,release) values(null,$1,'TICKET_READ_FAILED','error','tickets','local')", [randomUUID()], /operational_events_server_rows/);
    await as(A);
    assert.equal((await c.query("select * from operational_events where code='SERVER_ERROR'")).rowCount, 0, 'members never see server rows'); ok();
    assert.equal(await val("select record_operational_event($1,'TICKET_READ_FAILED','error','tickets','local',1::smallint)", [randomUUID()]), true, 'existing workspace logging still works'); ok();

    // ---------- 049 transcripts ----------
    const tokB = 'tok-b-' + randomUUID(), caseB = await mkCase(B, tokB);
    await as(null);
    const qid = await val('select support_reserve_knowledge($1,$2)', [sha(tokB), 'What are your hours?']);
    assert.equal(await val("select support_record_answer($1,$2,'We open at nine.','hosted_page')", [sha(tokB), qid]), true);
    assert.equal(await val("select support_record_answer($1,$2,'Changed answer','widget')", [sha(tokB), qid]), false, 'an answer is stored once'); ok();
    assert.equal(await val("select support_record_answer($1,$2,'x','mcp')", [sha(tokB), qid]), false, 'visitors cannot claim api/mcp sources'); ok();
    assert.equal(await val("select support_record_answer($1,$2,'x','widget')", [sha('wrong'), qid]), false); ok();
    await as(B);
    assert.deepEqual(await one('select answer,source from knowledge_interactions where id=$1', [qid]), {answer: 'We open at nine.', source: 'hosted_page'}); ok();
    await as(managerA, A);
    await rejects('select set_transcript_retention(30)', [], /Insufficient role/);
    await as(adminA, A);
    await rejects('select set_transcript_retention(60)', [], /Retention must be 30, 90 or 365 days/);
    assert.equal(await val('select set_transcript_retention(30)'), true); ok();
    await as(agentA, A);
    assert.equal(await val('select retention_days from transcript_settings'), 30, 'agents can read retention'); ok();
    await rejects('select delete_conversation($1)', [caseA], /Insufficient role/);
    await as(managerA, A);
    assert.equal(await val('select delete_conversation($1)', [caseB]), false, 'cannot delete another workspace conversation'); ok();
    const delMe = await mkCaseAs(A);
    assert.equal(await val('select delete_conversation($1)', [delMe]), true); ok();
    await c.query('RESET ROLE');
    assert.equal(await val("select actor_id from owner_audit_events where resource='support_cases' and operation='DELETE' and resource_id=$1", [delMe]), managerA, 'deletion audited with the actor'); ok();
    // Retention purge: A keeps 30 days, B uses the default 90.
    const oldA = await mkCase(A, randomUUID(), new Date(Date.now() - 40 * 86400e3).toISOString());
    const oldB = await mkCase(B, randomUUID(), new Date(Date.now() - 40 * 86400e3).toISOString());
    const oldB2 = await mkCase(B, randomUUID(), new Date(Date.now() - 100 * 86400e3).toISOString());
    const activeA = await mkCase(A, randomUUID(), new Date(Date.now() - 40 * 86400e3).toISOString());
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count,created_at) values($1,$2,'Recent activity',true,1,now()-interval '1 day')", [A, activeA]);
    await c.query("insert into support_messages(user_id,case_id,author,body) values($1,$2,'visitor','old message')", [A, oldA]);
    await c.query("update support_messages set created_at=now()-interval '35 days' where case_id=$1", [oldA]);
    await as('service');
    const purged = Number(await val('select purge_expired_transcripts(1000)'));
    await c.query('RESET ROLE');
    const left = (await c.query('select id from support_cases where id = any($1)', [[oldA, oldB, oldB2, activeA]])).rows.map((r) => r.id).sort();
    assert.deepEqual(left, [oldB, activeA].sort(), '30-day workspace purged at 40 days; 90-day default kept at 40 and purged at 100; recent activity keeps a case'); assert.ok(purged >= 2); ok();
    assert.equal(await val('select count(*)::int from support_messages where case_id=$1', [oldA]), 0, 'messages go with the conversation'); ok();

    // ---------- 050 scheduled refresh ----------
    await as(agentA, A);
    await rejects("select set_refresh_settings('weekly',null)", [], /Insufficient role/);
    await as(managerA, A);
    await rejects("select set_refresh_settings('hourly',null)", [], /Invalid frequency/);
    await rejects("select set_refresh_settings('weekly','http://insecure.example/sitemap.xml')", [], /refresh_settings_sitemap_url_check/);
    assert.equal(await val("select set_refresh_settings('weekly','https://shop.example/sitemap.xml')"), true); ok();
    await c.query('RESET ROLE');
    const d1id = randomUUID(), d2id = randomUUID();
    await c.query("insert into knowledge_documents(id,user_id,title,content,published) values($1,$3,'FAQ page','Source: https://shop.example/faq\n\nOld FAQ text for the store.',true),($2,$3,'Pasted text','Typed by hand, no source header at all.',true)", [d1id, d2id, A]);
    await as('service');
    const claimed = await val('select service_refresh_claim(5)') as {workspace: string; frequency: string; sitemapUrl: string}[];
    assert.deepEqual(claimed.filter((x) => x.workspace === A), [{workspace: A, frequency: 'weekly', sitemapUrl: 'https://shop.example/sitemap.xml'}]); ok();
    assert.equal((await val('select service_refresh_claim(5)') as unknown[]).filter((x) => (x as {workspace: string}).workspace === A).length, 0, 'a claimed workspace is not claimed twice'); ok();
    const srcs = await val('select service_refresh_sources($1)', [A]) as {id: string}[];
    assert.deepEqual(srcs.map((s) => s.id), [d1id], 'only saved website sources are re-checked'); ok();
    const items = [{kind: 'changed', url: 'https://shop.example/faq', title: 'FAQ page', documentId: d1id, content: 'Source: https://shop.example/faq\n\nNew FAQ text for the store.'}, {kind: 'new', url: 'https://shop.example/new', title: 'New', content: 'Source: https://shop.example/new\n\nA new page.'}, {kind: 'removed', url: 'https://shop.example/x', title: 'X', documentId: d2id}, {kind: 'changed', url: 'https://other.example/y', title: 'Y', documentId: randomUUID(), content: 'Source: https://other.example/y\n\nNot a document of A.'}];
    assert.equal(await val('select service_refresh_record($1,$2,$3)', [A, JSON.stringify(items), JSON.stringify({checked: 1})]), 3, 'unknown documents are skipped'); ok();
    assert.equal(await val('select service_refresh_record($1,$2,$3)', [A, JSON.stringify(items.slice(0, 1)), JSON.stringify({checked: 1})]), 1); ok();
    await c.query('RESET ROLE');
    assert.equal(await val("select count(*)::int from knowledge_refresh_items where user_id=$1 and status='pending'", [A]), 3, 'a pending URL is updated, not duplicated'); ok();
    const st = await one('select next_due_at>now()+interval \'6 days\' as later,last_summary from refresh_settings where user_id=$1', [A]);
    assert.equal(st.later, true); assert.deepEqual(st.last_summary, {checked: 1}); ok();
    assert.equal(await val('select content from knowledge_documents where id=$1', [d1id]), 'Source: https://shop.example/faq\n\nOld FAQ text for the store.', 'nothing is overwritten or published by the job'); ok();
    await as(agentA, A);
    assert.equal((await c.query('select * from knowledge_refresh_items')).rowCount, 0, 'agents do not see the queue'); ok();
    await as(B);
    assert.equal((await c.query('select * from knowledge_refresh_items')).rowCount, 0, 'B does not see A queue'); ok();
    const itemId = await val("select id from knowledge_refresh_items where user_id=$1 and kind='new'", [A]).catch(() => null);
    void itemId;
    await as(managerA, A);
    const newId = await val("select id from knowledge_refresh_items where kind='new'");
    await rejects("select resolve_refresh_item($1,'pending')", [newId], /Invalid status/);
    assert.equal(await val("select resolve_refresh_item($1,'dismissed')", [newId]), true);
    assert.equal(await val("select resolve_refresh_item($1,'applied')", [newId]), false, 'resolved once'); ok();
    await as(B);
    const removedId = (await c.query("select id from knowledge_refresh_items where kind='removed'")).rows[0]?.id;
    assert.equal(removedId, undefined); ok();
    await as(managerA, A);
    assert.equal(await val("select set_refresh_settings('off',null)"), true);
    await c.query('RESET ROLE');
    assert.equal(await val('select next_due_at from refresh_settings where user_id=$1', [A]), null, 'off means never due'); ok();

    // ---------- 051 insights and opens ----------
    await as(agentA, A);
    await rejects(`select set_insight_settings('["Billing"]',true)`, [], /Insufficient role/);
    await as(managerA, A);
    await rejects(`select set_insight_settings('["Billing","billing"]',true)`, [], /Duplicate topic name/);
    await rejects(`select set_insight_settings('["Other"]',true)`, [], /Invalid topic name/);
    await rejects(`select set_insight_settings('["<script>"]',true)`, [], /Invalid topic name/);
    await rejects(`select set_insight_settings('[]',true)`, [], /Give 1 to 12 topics/);
    assert.equal(await val(`select set_insight_settings('["Billing","Shipping & delivery"]',true)`), true); ok();
    await c.query('RESET ROLE');
    const ready = await mkCase(A, randomUUID(), new Date(Date.now() - 2 * 86400e3).toISOString()), fresh = await mkCase(A), silent = await mkCase(A, randomUUID(), new Date(Date.now() - 2 * 86400e3).toISOString());
    await c.query("insert into knowledge_interactions(user_id,case_id,question,answer,supported,source_count,created_at) values($1,$2,'Where is my parcel?','It ships Friday.',true,1,now()-interval '2 days'),($1,$3,'Just now?',null,false,0,now())", [A, ready, fresh]);
    await c.query("insert into support_requests(case_id,user_id,kind,message,contact_email,contact_consent,created_at) values($1,$2,'human_handoff','Please call me back.','buyer@example.com',true,now()-interval '2 days')", [ready, A]);
    await c.query("update support_cases set ticket_updated_at=now()-interval '2 days' where id=$1", [ready]); // the escalation trigger touched it
    await as('service');
    let pend = await val('select service_insights_pending(25)') as {caseId: string}[];
    const mine = (pend as {caseId: string; topics: string[]; requests: string[]}[]).filter((p) => ([ready, fresh, silent] as string[]).includes(p.caseId));
    assert.deepEqual(mine.map((p) => p.caseId), [ready], 'only finished conversations with a question are labelled'); assert.deepEqual(mine[0].topics, ['Billing', 'Shipping & delivery']); assert.deepEqual(mine[0].requests, ['human_handoff']); ok();
    assert.ok(!JSON.stringify(mine[0]).includes('buyer@example.com'), 'no contact details reach the labeller'); ok();
    assert.equal(await val('select service_insights_record($1)', [JSON.stringify([{caseId: ready, activityAt: new Date(Date.now() - 2 * 86400e3).toISOString(), topic: 'shipping & DELIVERY', sentiment: 'neutral', outcome: 'escalated', model: 'claude-haiku-5-5'}, {caseId: ready, topic: 'x', sentiment: 'bad', outcome: 'resolved', activityAt: new Date().toISOString()}])]), 1); ok();
    await c.query('RESET ROLE');
    assert.deepEqual(await one('select topic,sentiment,outcome from conversation_insights where case_id=$1', [ready]), {topic: 'Shipping & delivery', sentiment: 'neutral', outcome: 'escalated'}); ok();
    await as('service');
    await c.query('select service_insights_record($1)', [JSON.stringify([{caseId: ready, activityAt: new Date().toISOString(), topic: 'Crypto', sentiment: 'positive', outcome: 'resolved', model: 'm'}])]);
    pend = await val('select service_insights_pending(25)') as {caseId: string}[];
    assert.ok(!pend.some((p) => p.caseId === ready), 'a labelled conversation is not relabelled until it has new activity'); ok();
    await c.query('RESET ROLE');
    assert.equal(await val('select topic from conversation_insights where case_id=$1', [ready]), 'other', 'unknown topics become other'); ok();
    await as(managerA, A);
    await c.query(`select set_insight_settings('["Billing"]',false)`);
    await as('service');
    pend = await val('select service_insights_pending(25)') as {caseId: string}[];
    await c.query('RESET ROLE');
    await c.query("insert into knowledge_interactions(user_id,case_id,question,supported,source_count,created_at) values($1,$2,'Another one',true,1,now()-interval '1 day')", [A, silent]);
    await as('service');
    pend = await val('select service_insights_pending(25)') as {caseId: string}[];
    assert.ok(!pend.some((p) => p.caseId === silent), 'labelling off: nothing pending'); ok();
    // Widget opens.
    await as(null);
    const tokO = 'tok-o-' + randomUUID(); await c.query('RESET ROLE'); const caseO = await mkCase(A, tokO); await as(null);
    for (let i = 0; i < 3; i++) await c.query("select support_record_open($1,'widget')", [sha(tokO)]);
    assert.equal(await val("select support_record_open($1,'hosted_page')", [sha(tokO)]), true);
    assert.equal(await val("select support_record_open($1,'mcp')", [sha(tokO)]), false);
    assert.equal(await val("select support_record_open($1,'widget')", [sha('nope')]), false); ok();
    await as(agentA, A);
    assert.deepEqual((await c.query('select source,opens from widget_opens where case_id=$1 order by source', [caseO])).rows, [{source: 'hosted_page', opens: 1}, {source: 'widget', opens: 3}]); ok();
    await as(B);
    assert.equal((await c.query('select * from widget_opens')).rowCount, 0); assert.equal((await c.query('select * from conversation_insights')).rowCount, 0); ok();

    // ---------- delete_preview_data covers every new table ----------
    await as(adminA, A);
    await rejects("select delete_preview_data('DELETE MY PREVIEW DATA')", [], /Insufficient role/);
    await as(A);
    assert.equal(await val("select delete_preview_data('DELETE MY PREVIEW DATA')"), true);
    await c.query('RESET ROLE');
    for (const t of ['email_settings', 'email_log', 'transcript_settings', 'refresh_settings', 'knowledge_refresh_items', 'insight_settings', 'conversation_insights', 'widget_opens', 'knowledge_interactions', 'support_cases'])
      assert.equal(await val(`select count(*)::int from ${t} where user_id=$1`, [A]), 0, t + ' cleared');
    ok();
    assert.ok(Number(await val('select count(*) from email_log where user_id=$1', [B])) > 0, 'B untouched'); assert.equal(await val("select count(*)::int from operational_events where code='SERVER_ERROR' and request_id=$1", [req]), 1, 'server rows are not workspace data'); ok();
    console.log(`PASS production DB (048-051): ${n} checks; email settings/log roles, reservations with caps (20/day, 50 replies, digest once per 6 days, off = suppressed), finish once per workspace, audit actors, no address/content columns, service-only functions refused for members and anon, digest numbers, server errors invisible to members; transcript answers stored once, retention roles, purge by 30/90-day retention and last activity, conversation delete roles and audit; refresh schedule roles, claims once, website sources only, queue upsert without publishing, resolve once; insight topics validated, pending excludes fresh/silent/disabled, unknown topics become other, opens counted; delete_preview_data clears every new table; rollback only.`);
    async function mkCaseAs(ws: string) { await c.query('RESET ROLE'); const id = await mkCase(ws); await as(managerA, A); return id; }
  } finally { await c.query('ROLLBACK'); await c.end(); }
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
