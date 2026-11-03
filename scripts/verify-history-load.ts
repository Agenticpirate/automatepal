// Chat history loader at volume, against the LOCAL Supabase (gateway + PostgREST + RLS), not a mock.
// Seeds one synthetic workspace with 320 conversations (questions with answers, person-chat messages and
// requests), signs in as its owner and loads transcripts the way /api/history and the account-data export
// do. Before batching, one `case_id=in.(...)` filter with 300 ids got 414 URI too long from the gateway.
// Local only: refuses non-local hosts. Removes the synthetic user (and by cascade its rows) afterwards.
// Usage: eval "$(npx supabase status --workdir .supabase-local -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
//        API_URL=$API_URL ANON_KEY=$ANON_KEY SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npx tsx scripts/verify-history-load.ts
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {loadConversations, batches, ID_BATCH} from '../lib/transcripts-load';
const {API_URL, ANON_KEY, SERVICE_ROLE_KEY} = process.env;
const DB = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
for (const u of [API_URL, DB]) if (!u || !['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('verify-history-load: API_URL and LOCAL_DATABASE_URL must be the local Supabase.'); process.exit(1); }
if (!ANON_KEY || !SERVICE_ROLE_KEY) { console.error('verify-history-load: set ANON_KEY and SERVICE_ROLE_KEY (local Supabase).'); process.exit(1); }
const CASES = 320;
let n = 0; const ok = () => { n++; };
const admin = createClient(API_URL!, SERVICE_ROLE_KEY!, {auth: {persistSession: false}});
const db = new pg.Client({connectionString: DB});
const email = `history.${randomUUID().slice(0, 8)}@load.example.test`, password = 'Local-only-' + randomUUID();
let userId = '';
async function main() {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]); assert.equal(batches([]).length, 0); assert.equal(ID_BATCH, 100); ok();
  const created = await admin.auth.admin.createUser({email, password, email_confirm: true});
  if (created.error) throw created.error;
  userId = created.data.user.id;
  await db.connect();
  // Oldest first; ticket_updated_at decides which 300 the loader takes (newest), so case k=319 is the newest.
  await db.query(`insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount,created_at,ticket_updated_at)
    select gen_random_uuid(),$1::uuid,encode(sha256(($1::uuid::text||k::text)::bytea),'hex'),now()+interval '1 hour','History load '||k,19,now()-interval '10 days'+k*interval '1 minute',now()-interval '10 days'+k*interval '1 minute'
    from generate_series(0,$2-1) k`, [userId, CASES]);
  await db.query(`insert into knowledge_interactions(user_id,case_id,question,answer,source,supported,source_count,created_at)
    select user_id,id,'Question for '||order_label,'Answer for '||order_label,'widget',true,1,created_at+interval '5 seconds' from support_cases where user_id=$1`, [userId]);
  await db.query(`insert into support_messages(user_id,case_id,author,body,created_at)
    select user_id,id,'owner','Team reply for '||order_label,created_at+interval '9 seconds' from support_cases where user_id=$1 and right(order_label,1)='0'`, [userId]);
  await db.query(`insert into support_requests(user_id,case_id,kind,message,created_at)
    select user_id,id,'billing_question','Request for '||order_label,created_at+interval '7 seconds' from support_cases where user_id=$1 and right(order_label,2) in ('05','55')`, [userId]);
  assert.equal(Number((await db.query('select count(*) from support_cases where user_id=$1', [userId])).rows[0].count), CASES); ok();

  const s = await createClient(API_URL!, ANON_KEY!, {auth: {persistSession: false}}).auth.signInWithPassword({email, password});
  if (s.error) throw s.error;
  const client = createClient(API_URL!, ANON_KEY!, {auth: {persistSession: false}, global: {headers: {Authorization: `Bearer ${s.data.session.access_token}`}}});

  // For the record: the pre-fix single request with 300 ids (informational; the gateway limit may differ).
  const ids = (await client.from('support_cases').select('id').eq('user_id', userId).order('ticket_updated_at', {ascending: false}).limit(300)).data?.map((x) => x.id as string) ?? [];
  const single = await client.from('knowledge_interactions').select('id').eq('user_id', userId).in('case_id', ids).limit(1);
  console.log(`single request with ${ids.length} ids: ${single.error ? 'error ' + (single.status || '') + ' ' + (single.error.message || '').slice(0, 60) : 'ok'}`);

  const loaded = await loadConversations({client, userId});
  assert.ok(loaded, 'loader returns data, not null (null made /api/history answer 503)'); ok();
  assert.equal(loaded!.conversations.length, 300); assert.equal(loaded!.truncated, true, 'more than 300 conversations: truncated'); ok();
  const labels = new Set(loaded!.conversations.map((c) => c.id));
  assert.equal(labels.size, 300); ok();
  const withAnswer = loaded!.conversations.filter((c) => c.entries.some((e) => e.author === 'ai' && /^Answer for History load \d+$/.test(e.text)));
  assert.equal(withAnswer.length, 300, 'every conversation in every batch has its question and AI answer'); ok();
  const owner = loaded!.conversations.filter((c) => c.entries.some((e) => e.author === 'owner'));
  assert.equal(owner.length, 30, 'team replies from all batches (cases 20..319 ending in 0)'); ok();
  const req = loaded!.conversations.filter((c) => c.entries.some((e) => e.author === 'request'));
  assert.equal(req.length, 6, 'requests from all batches (05/55 endings among cases 20..319)'); ok();
  const oldest = loaded!.conversations.find((c) => c.preview === 'Question for History load 20');
  assert.ok(oldest, 'the oldest included case (last batch) is present'); assert.equal(oldest!.entries[0].author, 'visitor'); ok();
  const all = await loadConversations({client, userId}, CASES);
  assert.equal(all!.conversations.length, CASES); assert.equal(all!.truncated, true); ok();
  // RLS still applies per batch: another user's client sees nothing of this workspace.
  const other = await admin.auth.admin.createUser({email: 'other.' + email, password, email_confirm: true});
  if (other.error) throw other.error;
  try {
    const so = await createClient(API_URL!, ANON_KEY!, {auth: {persistSession: false}}).auth.signInWithPassword({email: 'other.' + email, password});
    if (so.error) throw so.error;
    const oc = createClient(API_URL!, ANON_KEY!, {auth: {persistSession: false}, global: {headers: {Authorization: `Bearer ${so.data.session.access_token}`}}});
    const seen = await loadConversations({client: oc, userId});
    assert.deepEqual(seen, {conversations: [], truncated: false}, 'another user cannot load this workspace'); ok();
  } finally { await admin.auth.admin.deleteUser(other.data.user.id); }
  console.log(`PASS history load: ${n} checks; ${CASES} conversations loaded through the local gateway in batches of ${ID_BATCH}.`);
}
main().catch((e) => { console.error('FAIL history load:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {}); await db.end().catch(() => {}); });
