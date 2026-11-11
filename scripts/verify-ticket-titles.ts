// Ticket titles for conversations without an order label (lib/ticket-titles.ts) and the Chat history preview for
// the same conversations (lib/transcripts.ts). No network.
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {withTitles, titleFrom, UNTITLED} from '../lib/ticket-titles';
import {buildConversations} from '../lib/transcripts';
let n = 0;
const ok = () => { n++; };
const client = (rows: {case_id: string; question: string; created_at: string}[], fail = false) => {
  const calls: string[][] = [];
  const q = {select: () => q, eq: () => q, in: (_: string, ids: string[]) => { calls.push(ids); return q; }, order: () => q, limit: async () => fail ? {data: null, error: {message: 'x'}} : {data: rows.filter(r => calls[calls.length - 1].includes(r.case_id)), error: null}};
  return {client: {from: () => q} as unknown as SupabaseClient, calls};
};
async function main() {
  assert.equal(titleFrom('  How do I   reset\nmy password? '), 'How do I reset my password?'); assert.equal(titleFrom(''), UNTITLED); assert.equal(titleFrom(null), UNTITLED);
  assert.ok(titleFrom('x'.repeat(200)).length <= 90 && titleFrom('x'.repeat(200)).endsWith('…')); ok();
  const tickets = [{id: 'a', order_label: 'Order 1001'}, {id: 'b', order_label: null}, {id: 'c', order_label: null}, {id: 'd', order_label: ''}];
  const c = client([{case_id: 'b', question: 'First question', created_at: '1'}, {case_id: 'b', question: 'Second question', created_at: '2'}, {case_id: 'd', question: 'Do you ship abroad?', created_at: '1'}]);
  assert.deepEqual((await withTitles(c.client, 'ws', tickets)).map(t => t.order_label), ['Order 1001', 'First question', UNTITLED, 'Do you ship abroad?']); ok();
  assert.deepEqual(c.calls, [['b', 'c', 'd']], 'only tickets without a label are looked up'); ok();
  // A failed read still gives every ticket a title; nothing is looked up when all have labels.
  assert.deepEqual((await withTitles(client([], true).client, 'ws', tickets)).map(t => t.order_label), ['Order 1001', UNTITLED, UNTITLED, UNTITLED]); ok();
  const none = client([]); await withTitles(none.client, 'ws', [tickets[0]]); assert.deepEqual(none.calls, []); ok();
  // 250 unlabelled tickets are read in batches of 100.
  const many = client([]); await withTitles(many.client, 'ws', Array.from({length: 250}, (_, i) => ({id: 'x' + i, order_label: null}))); assert.deepEqual(many.calls.map(x => x.length), [100, 100, 50]); ok();
  // Chat history: a conversation with no order label and nothing asked yet has an empty preview instead of crashing.
  const conv = buildConversations([{id: '11111111-1111-4111-8111-111111111111', created_at: '2026-11-10T00:00:00Z', ticket_status: 'new', inbox_state: 'open', order_label: null}], [], [], []);
  assert.equal(conv.length, 1); assert.equal(conv[0].preview, ''); ok();
  console.log(`PASS ticket titles: ${n} checks; first question as the title, generic title when nothing was asked or the read fails, labelled tickets untouched, batched lookups, Chat history preview safe without an order label.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
