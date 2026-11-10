// db/066: retrieval for visitor answers. Text passages pass at 0.62 (top 6), owner guidance keeps 0.72 (top 4);
// the three-argument form adds up to 2 passages that share question words and score 0.55 or more. Unpublished
// sources, other workspaces and unknown conversation tokens return nothing. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-retrieval-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-retrieval-db: refusing non-local host'); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const ok = () => { n++; };
// A 768-dimension unit vector whose cosine with the query (first axis) is exactly `score`.
const vec = (score: number) => JSON.stringify([score, Math.sqrt(1 - score * score), ...Array(766).fill(0)]);
const QUERY = JSON.stringify([1, ...Array(767).fill(0)]);
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    const A = randomUUID(), B = randomUUID(), tok = randomUUID() + randomUUID(), tokB = randomUUID() + randomUUID();
    for (const u of [A, B]) await c.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [u, `${u.slice(0, 8)}@retrieval.example.test`]);
    for (const [u, t] of [[A, tok], [B, tokB]]) await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Retrieval fixture',19)", [randomUUID(), u, sha(t)]);
    const doc = async (ws: string, kind: 'text' | 'owner_guidance', published = true) => { const id = randomUUID(); await c.query("insert into knowledge_documents(id,user_id,title,content,published,source_kind,applicability,effective_from,effective_until) values($1,$2,'Fixture source','Fixture source content for retrieval.',$3,$4,$5,$6,$7)", [id, ws, published, kind, kind === 'owner_guidance' ? 'Applies to every visitor' : '', kind === 'owner_guidance' ? '2026-01-01' : null, kind === 'owner_guidance' ? '2027-01-01' : null]); return id; };
    let pos = 0;
    const chunk = async (ws: string, d: string, score: number, content: string) => { await c.query("insert into knowledge_chunks(id,document_id,user_id,position,content,embedding,model) values($1,$2,$3,$4,$5,$6::vector,'gemini-embedding-2')", [randomUUID(), d, ws, pos++, content, vec(score)]); };
    const text = await doc(A, 'text'), guide = await doc(A, 'owner_guidance'), hidden = await doc(A, 'text', false), other = await doc(B, 'text');
    for (const s of [0.9, 0.8, 0.75, 0.7, 0.68, 0.66, 0.64]) await chunk(A, text, s, `General passage scoring ${s} about plans and answers.`);
    await chunk(A, text, 0.61, 'Just under the floor, about plans.');
    await chunk(A, text, 0.6, 'A WordPress plugin installs the widget from the WordPress dashboard.');
    await chunk(A, text, 0.58, 'Contact the team by email from the contact page.');
    await chunk(A, text, 0.5, 'WordPress is also mentioned here but this passage is far from the question.');
    await chunk(A, guide, 0.75, 'Owner guidance that applies.'); await chunk(A, guide, 0.7, 'Owner guidance under its own threshold.');
    await chunk(A, hidden, 0.95, 'Unpublished WordPress passage.'); await chunk(B, other, 0.95, 'Another workspace WordPress passage.');
    await c.query('SET LOCAL ROLE anon');
    const run = async (t: string, q?: string) => ((await c.query(q === undefined ? 'select support_knowledge_vectors($1,$2::vector) r' : 'select support_knowledge_vectors($1,$2::vector,$3) r', q === undefined ? [sha(t), QUERY] : [sha(t), QUERY, q])).rows[0].r as {excerpt: string; score: number; sourceKind: string}[]);
    // Similarity only (two arguments): 6 text passages from 0.62 up, guidance from 0.72 up, listed after the text passages.
    const plain = await run(tok);
    assert.deepEqual(plain.map(x => [x.sourceKind, Math.round(x.score * 100) / 100]), [['text', 0.9], ['text', 0.8], ['text', 0.75], ['text', 0.7], ['text', 0.68], ['text', 0.66], ['owner_guidance', 0.75]]); ok();
    assert.ok(!plain.some(x => /Unpublished|Another workspace/.test(x.excerpt)), 'published sources of this workspace only'); ok();
    // With the question: the passage sharing its word joins, even below the floor (0.55 or more); the far one does not.
    const wp = await run(tok, 'Does it work with WordPress?');
    assert.equal(wp.length, 8); assert.ok(wp.some(x => x.excerpt.startsWith('A WordPress plugin'))); assert.ok(!wp.some(x => /far from the question|Unpublished|Another workspace/.test(x.excerpt))); ok();
    const contact = await run(tok, 'How can I contact your team?');
    assert.ok(contact.some(x => x.excerpt.startsWith('Contact the team')), 'stemmed word match'); assert.ok(contact.length <= 9); ok();
    // No shared words, an empty question or only stop words: the similarity result unchanged.
    for (const q of ['Zebra xylophone?', '', 'is it the', '!!! ??? &|:*']) assert.equal((await run(tok, q)).length, 7, JSON.stringify(q));
    ok();
    // At most 2 keyword passages are added.
    assert.ok((await run(tok, 'plans answers WordPress contact email floor')).filter(x => x.sourceKind === 'text').length <= 8); ok();
    // Unknown conversation: nothing. Another workspace sees only its own.
    assert.deepEqual(await run('unknown', 'WordPress'), []); assert.deepEqual((await run(tokB, 'WordPress')).map(x => x.excerpt), ['Another workspace WordPress passage.']); ok();
    console.log(`PASS retrieval DB (066): ${n} checks; text floor 0.62 top 6, guidance 0.72, keyword passages (stemmed, at most 2, 0.55 or more), odd question text safe, unpublished and other workspaces excluded.`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
