// Passage splitting and the secret check on documentation text (Phase 6 own-site trial findings). No network.
import assert from 'node:assert/strict';
import {chunkKnowledge, safeKnowledge} from '../lib/knowledge';
import {TEXT_RETRIEVAL_THRESHOLD, TEXT_RETRIEVAL_LIMIT, OWNER_RETRIEVAL_THRESHOLD} from '../lib/owner-retrieval';
let n = 0;
const ok = () => { n++; };
const para = (w: string, len: number) => (w + ' ').repeat(Math.ceil(len / (w.length + 1))).slice(0, len).trim() + '.';
// Paragraphs are packed whole; a passage that continues a section starts with that section's heading.
const doc = ['# Pricing', para('intro', 300), '## Growth', para('growth', 700), para('more', 700), '## Scale', para('scale', 500)].join('\n\n');
const chunks = chunkKnowledge(doc);
assert.ok(chunks.length >= 3 && chunks.every(c => c.length <= 1200), 'bounded passages'); ok();
assert.ok(chunks[0].startsWith('# Pricing')); ok();
const more = chunks.find(c => c.includes('more more'))!;
assert.ok(more.startsWith('## Growth\n'), 'continued section carries its heading'); ok();
assert.ok(chunks.find(c => c.includes('scale scale'))!.includes('## Scale')); ok();
for (const c of chunks) assert.ok(/[.]$|^#/.test(c.trim().split('\n').pop()!), 'no passage ends mid-paragraph');
ok();
// Every paragraph survives.
for (const w of ['intro', 'growth', 'more', 'scale']) assert.ok(chunks.some(c => c.includes(w + ' ' + w)), w);
ok();
// A very long paragraph is cut into overlapping windows that keep the heading; a huge source still fits 30 passages.
const long = chunkKnowledge('## Terms\n\n' + para('clause', 3000));
assert.ok(long.length >= 3 && long.every(c => c.startsWith('## Terms') && c.length <= 1200)); ok();
const huge = chunkKnowledge(Array.from({length: 120}, (_, i) => `## Section ${i}\n\n` + para('text', 230)).join('\n\n'));
assert.ok(huge.length <= 30 && huge.every(c => c.length <= 1200), 'falls back to windows within the limit'); ok();
assert.throws(() => chunkKnowledge('x'.repeat(40000)), /Too many chunks/); ok();
assert.deepEqual(chunkKnowledge('Short answer about refunds and returns.'), ['Short answer about refunds and returns.']); ok();
// Secret check: documentation prose about keys passes; values that look like credentials are refused.
for (const fine of ['An API key: test_ for test, live_ for live.', 'Credential: API key', 'Password: choose a long one', 'Your access token: created on the Integrations page'])
  assert.doesNotThrow(() => safeKnowledge(fine), fine);
ok();
for (const bad of ['api_key=secretfixturevalue123', 'password: hunter2', 'client_secret = abcdefghijklmnopqrstuvwx', 'access token: 9f8e7d6c5b4a', '-----BEGIN PRIVATE KEY-----', 'sk_live_abcdefghijkl1234'])
  assert.throws(() => safeKnowledge(bad), /Possible secret/, bad);
ok();
assert.ok(TEXT_RETRIEVAL_THRESHOLD < OWNER_RETRIEVAL_THRESHOLD && TEXT_RETRIEVAL_LIMIT === 6); ok();
console.log(`PASS knowledge passages: ${n} checks; paragraph-packed passages with section headings, long paragraphs windowed, 30-passage fallback, documentation prose passes the secret check and credential-like values do not.`);
