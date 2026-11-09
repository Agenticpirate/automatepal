// Phase 3 units without network or database: model tier settings per Claude family, GitHub repo parsing and
// docs import (fake fetcher), Word (.docx) extraction (zip built here; zip-bomb and wrong-file guards), Slack
// alert text (no visitor text) and URL guard, and the webhook worker loop.
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {anthropicSettings, llmModel} from '../lib/llm';
import {parseGithubRepo, importGithubDocs, cleanMarkdown} from '../lib/github-import';
import {docxDocumentXml, docxXmlToText, DocxError} from '../lib/docx-text';
import {slackMessage, postSlack, SLACK_URL} from '../lib/slack';
import {deliverDueWebhooks} from '../lib/webhook-worker';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SafeGetResult} from '../lib/url-import';
let n = 0;
const ok = () => { n++; };
// Minimal zip writer for tests: one entry per [name, data], deflated.
function zip(entries: [string, string][], store = false): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text), data = store ? raw : deflateRawSync(raw), nameB = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(store ? 0 : 8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(store ? 0 : 8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, data); central.push(ch, nameB); offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
async function main() {
  // Model tiers.
  const env = process.env as Record<string, string | undefined>;
  delete env.ANTHROPIC_DEEP_MODEL; delete env.ANTHROPIC_MODEL;
  assert.equal(llmModel('anthropic', 'fast'), 'claude-haiku-5-5'); assert.equal(llmModel('anthropic', 'deep'), 'claude-sonnet-5-5'); ok();
  assert.deepEqual(anthropicSettings('claude-haiku-5-5', {maxTokens: 900}).body, {thinking: {type: 'disabled'}}); ok();
  const son = anthropicSettings('claude-sonnet-5-5', {maxTokens: 900, temperature: 0.1});
  assert.deepEqual(son.body.thinking, {type: 'between_tools'}); assert.equal(son.body.fallbacks, 'default'); assert.equal(son.beta, 'server-side-fallback-2026-07-01'); assert.ok(!('temperature' in son.body), 'no temperature on Sonnet 5.5'); ok();
  const opus = anthropicSettings('claude-opus-5-5', {maxTokens: 900});
  assert.ok(!('thinking' in opus.body), 'Opus 5.5 thinking cannot be disabled'); assert.equal(opus.maxTokens, 3900); ok();
  assert.deepEqual(anthropicSettings('claude-haiku-4-5-20251001', {maxTokens: 50, temperature: 0.2}).body, {temperature: 0.2}); ok();

  // GitHub.
  assert.deepEqual(parseGithubRepo('https://github.com/acme/docs-site'), {owner: 'acme', repo: 'docs-site', ref: null, path: ''});
  assert.deepEqual(parseGithubRepo('https://github.com/acme/site/tree/main/docs/guides'), {owner: 'acme', repo: 'site', ref: 'main', path: 'docs/guides'});
  assert.deepEqual(parseGithubRepo('acme/site'), {owner: 'acme', repo: 'site', ref: null, path: ''});
  for (const bad of ['http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/a/b/issues', 'javascript:alert(1)', 'a/b/c']) assert.equal(parseGithubRepo(bad), null, bad);
  ok();
  assert.equal(cleanMarkdown('---\ntitle: x\n---\n# Hi\n<!-- note -->\n\n\n\nText'), '# Hi\n\nText'); ok();
  const calls: string[] = [];
  const res = (status: number, body: string): SafeGetResult => ({status, body, contentType: 'text/plain', bytes: body.length, truncated: false, finalUrl: ''});
  const fake = (async (url: string) => {
    calls.push(url);
    if (url.startsWith('https://api.github.com/')) return res(200, JSON.stringify({tree: [
      {path: 'README.md', type: 'blob', size: 100}, {path: 'docs/refunds.md', type: 'blob', size: 200}, {path: 'docs/img.png', type: 'blob', size: 10},
      {path: 'docs/CHANGELOG.md', type: 'blob', size: 50}, {path: 'node_modules/x/README.md', type: 'blob', size: 10}, {path: 'docs/huge.md', type: 'blob', size: 900000}, {path: 'docs', type: 'tree'}]}));
    if (url.endsWith('/docs/refunds.md')) return res(200, '---\nslug: r\n---\n# Refund policy\n\nRefunds are reviewed by a person within five working days.');
    return res(404, '');
  }) as unknown as typeof import('../lib/url-import').safeGet;
  const r = await importGithubDocs({owner: 'acme', repo: 'site', ref: 'main', path: 'docs'}, {get: fake});
  assert.equal(r.pages.length, 1); assert.equal(r.pages[0].title, 'Refund policy'); assert.equal(r.pages[0].url, 'https://github.com/acme/site/blob/main/docs/refunds.md'); assert.ok(!r.pages[0].markdown.includes('slug:')); ok();
  assert.ok(calls.every(u => u.startsWith('https://api.github.com/') || u.startsWith('https://raw.githubusercontent.com/')), 'only GitHub hosts'); assert.equal(calls.length, 2, 'filtered: png, CHANGELOG, node_modules, oversize, outside path'); ok();
  await assert.rejects(importGithubDocs({owner: 'acme', repo: 'gone', ref: null, path: ''}, {get: (async () => res(404, '')) as never}), /not found/); ok();

  // Word.
  const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Shipping &amp; returns</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Orders ship in </w:t></w:r><w:r><w:t>2 days.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Plan</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:delText>deleted</w:delText><w:t>Line</w:t><w:br/><w:t>break</w:t></w:r></w:p></w:body></w:document>';
  const docx = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', xml]]);
  const text = docxXmlToText(await docxDocumentXml(docx)).text;
  assert.match(text, /^Shipping & returns\nOrders ship in 2 days\./); assert.ok(text.includes('Plan') && text.includes('Price')); assert.ok(text.includes('Line\nbreak')); assert.ok(!text.includes('deleted'), 'tracked deletions dropped'); ok();
  assert.equal(docxXmlToText(await docxDocumentXml(zip([['word/document.xml', xml]], true))).text, text, 'stored (uncompressed) entries work'); ok();
  await assert.rejects(docxDocumentXml(new TextEncoder().encode('%PDF-1.7 not a zip')), DocxError);
  await assert.rejects(docxDocumentXml(zip([['other.xml', '<x/>']])), /No document text/);
  const bomb = zip([['word/document.xml', '<w:t>' + 'A'.repeat(6 * 1024 * 1024) + '</w:t>']]);
  assert.ok(bomb.length < 100_000, 'small file'); await assert.rejects(docxDocumentXml(bomb), /too large once unpacked/); ok();

  // Slack.
  const msg = slackMessage('handoff', '11111111-2222-4333-8444-555555555555', 'https://automatepal.com').text;
  assert.match(msg, /asked to talk to a person/); assert.match(msg, /https:\/\/automatepal\.com\/tickets/); ok();
  assert.ok(SLACK_URL.test('https://hooks.slack.com/services/T0/B0/abcdefgh12')); assert.ok(!SLACK_URL.test('https://hooks.slack.com.evil.example/services/T0/B0/abcdefgh12'));
  let hit = 0; const f = (async () => { hit++; return new Response('ok'); }) as typeof fetch;
  assert.equal(await postSlack('https://evil.example/hook', {}, f), 0); assert.equal(hit, 0, 'non-Slack URL never fetched');
  assert.equal(await postSlack('https://hooks.slack.com/services/T0/B0/abcdefgh12', {}, f), 200); ok();

  // Webhook worker.
  const finished: unknown[] = [];
  const db = {rpc: async (name: string, a: Record<string, unknown>) => name === 'service_webhook_claim' ? {data: [{id: 'e1', url: 'u', secret: 's', payload: {}, attempt: 1}, {id: 'e2', url: 'u', secret: 's', payload: {}, attempt: 2}], error: null} : (finished.push(a), {data: true, error: null})} as unknown as SupabaseClient;
  const run = await deliverDueWebhooks(db, {deliver: (async (_u: string, _s: string, _p: unknown, id: string) => { if (id === 'e2') throw Error('down'); return 202; }) as never});
  assert.deepEqual(run, {ok: true, claimed: 2, delivered: 1, failed: 1}); assert.deepEqual(finished, [{p_id: 'e1', p_status: 202, p_attempt: 1}, {p_id: 'e2', p_status: 0, p_attempt: 2}]); ok();
  assert.deepEqual(await deliverDueWebhooks({rpc: async () => ({data: null, error: {message: 'x'}})} as unknown as SupabaseClient), {ok: false, claimed: 0, delivered: 0, failed: 0}); ok();
  console.log(`PASS phase 3 units: ${n} checks; model tier settings per Claude family, GitHub parsing and filtered import from GitHub hosts only, Word extraction (deflate and stored, tracked deletions, zip-bomb and wrong-file guards), Slack text and URL guard, webhook worker.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
