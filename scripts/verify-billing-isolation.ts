// Customer verification and isolation, end to end through the billing service, against the PayPal
// contract mock and an in-memory store that mirrors the 044 RPC rules. Throwaway keys only.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
process.env.BILLING_ENCRYPTION_KEYS = 'k1:' + randomBytes(32).toString('base64');
process.env.BILLING_ENCRYPTION_ACTIVE_KID = 'k1';
process.env.BILLING_RPC_SECRET = randomBytes(32).toString('hex');
import {startMock} from './billing-contract/mock-server';
import {memoryStore} from './billing-contract/memory-store';
import {answerBilling, requestRefundReview, verifyVisitor, VERIFY_FAILED, VERIFY_REQUIRED, REFUND_NOTE, type ServiceDeps} from '../lib/billing/core/service';
import {providerDefinition} from '../lib/billing/core/registry';
import {billingIntent} from '../lib/billing/core/intent';
import {openScope, serverProof} from '../lib/billing/core/crypto';
import {clearCache} from '../lib/billing/core/cache';
import {resetAllBreakers} from '../lib/billing/core/breaker';
import type {BillingIntent} from '../lib/billing/core/types';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const ORDER_A = '7AB12345CD678901E', ORDER_B = '9XY98765ZW432109V', SUB_B = 'I-BBBB2222CCCC';
const RAW_REFS = [ORDER_A, ORDER_B, 'AP-1001', 'INV2-AAAA-BBBB-CCCC-DDDD', 'I-AAAA1111BBBB', SUB_B, '3CA11111AA111111A', '1RF11111AA111111A'];
const h = () => createHash('sha256').update(randomUUID()).digest('hex');
let n = 0;
const ok = () => n++;

async function main() {
  const mock = await startMock('paypal');
  let clock = Date.parse('2026-10-31T12:00:00Z');
  const mem = memoryStore(() => clock);
  const ws = randomUUID();
  const cred = {clientId: 'AYfictionalClientId00000000001', clientSecret: 'EFfictionalClientSecret0000000001'};
  const conn = mem.connect(ws, 'paypal', 'test', cred);
  const d: ServiceDeps = {store: mem.store, now: () => clock, definitionFor: providerDefinition, adapterDeps: () => ({baseUrlOverride: mock.baseUrl, sleep: async () => undefined, now: () => clock})};
  const caseA = h(), caseB = h();
  mem.addCase(caseA, ws); mem.addCase(caseB, ws);
  const ask = (c: string, intent: BillingIntent) => answerBilling(d, {caseHash: c, intent});
  try {
    // 1. No lookup without verification, and no provider call.
    let r = await ask(caseA, 'order_status');
    assert.equal(r.ok, false); assert.equal(!r.ok && r.kind, 'verification_required'); assert.equal(!r.ok && r.error, VERIFY_REQUIRED); ok();
    assert.equal(mock.requests.length, 0); ok();

    // 2. Mismatch and unknown read exactly alike; email case and spaces are ignored on a match.
    const wrong = await verifyVisitor(d, {caseHash: caseA, provider: 'paypal', reference: ORDER_A, email: B});
    const unknown = await verifyVisitor(d, {caseHash: caseA, provider: 'paypal', reference: 'ZZZZZZZZZZZZZZZZZ', email: A});
    const badPattern = await verifyVisitor(d, {caseHash: caseA, provider: 'paypal', reference: '!!', email: A});
    assert.ok(!wrong.ok && !unknown.ok && !badPattern.ok); ok();
    assert.equal(!wrong.ok && wrong.error, VERIFY_FAILED); assert.equal(!unknown.ok && unknown.error, VERIFY_FAILED); assert.equal(!badPattern.ok && badPattern.error, VERIFY_FAILED); ok();
    const bWithA = await verifyVisitor(d, {caseHash: caseB, provider: 'paypal', reference: ORDER_B, email: A});
    assert.equal(bWithA.ok, false, "B's reference with A's email fails"); ok();
    const va = await verifyVisitor(d, {caseHash: caseA, provider: 'paypal', reference: ORDER_A, email: '  Alex.Payer@Example.TEST '});
    assert.ok(va.ok); assert.equal(va.ok && va.mode, 'test'); assert.ok(va.ok && va.expiresAt && Date.parse(va.expiresAt) === clock + 30 * 60_000, '30-minute verification'); ok();
    const vb = await verifyVisitor(d, {caseHash: caseB, provider: 'paypal', reference: ORDER_B, email: B});
    assert.ok(vb.ok); ok();

    clock += 11_000; // token bucket refill (10 requests / 10 s per connection)
    // 3. Verified A sees only A's order; B sees only B's (cache never crosses verifications).
    r = await ask(caseA, 'order_status');
    assert.ok(r.ok); const ra = r.ok ? r.answer : null;
    assert.ok(ra && ra.cards.length > 0 && ra.cards.every((c) => c.id === ORDER_A || c.parentRef === ORDER_A)); ok();
    assert.ok(ra && ra.answer.endsWith('Read-only Test mode record. No money moved.')); ok();
    const before = mock.requests.length;
    r = await ask(caseA, 'order_status');
    assert.equal(mock.requests.length, before, 'second identical lookup is served from cache'); ok();
    r = await ask(caseB, 'order_status');
    assert.ok(r.ok && r.answer.cards.length > 0 && r.answer.cards.every((c) => c.id === ORDER_B || c.parentRef === ORDER_B), "cache never serves A's record to B"); ok();
    assert.ok(mock.requests.length > before, "B's lookup went to the provider"); ok();
    assert.ok(mock.requests.filter((q) => q.url.includes(ORDER_B)).length >= 1 && !mock.requests.some((q) => q.url.includes(SUB_B)), "A's scope never queried B's subscription"); ok();

    // 4. A's sealed scope cannot be opened under B's case or another provider.
    const vA = mem.verifications.find((v) => v.caseId === mem.cases.get(caseA)!.id)!;
    assert.ok(openScope(vA.scope, caseA, 'paypal')); assert.equal(openScope(vA.scope, caseB, 'paypal'), null); assert.equal(openScope(vA.scope, caseA, 'stripe'), null); ok();

    clock += 11_000; // token bucket refill (10 requests / 10 s per connection)
    // 5. Provider returning another customer's record (mixed_customers) is filtered out.
    clearCache();
    mock.setMode('mixed_customers');
    r = await ask(caseA, 'order_status');
    assert.ok(r.ok && r.answer.cards.length === 0 && r.outcome === 'no_records', 'mixed response filtered'); ok();
    assert.ok(r.ok && !JSON.stringify(r.answer).includes(ORDER_B)); ok();
    mock.setMode('normal');

    clock += 11_000; // token bucket refill (10 requests / 10 s per connection)
    // 6. Five failed verifications lock the case out without further provider calls.
    const ws3 = randomUUID(); mem.connect(ws3, 'paypal', 'test', cred);
    const caseC = h(); mem.addCase(caseC, ws3);
    for (let i = 0; i < 5; i++) { const x = await verifyVisitor(d, {caseHash: caseC, provider: 'paypal', reference: ORDER_A, email: B}); assert.equal(x.ok, false); }
    const calls = mock.requests.length;
    const locked = await verifyVisitor(d, {caseHash: caseC, provider: 'paypal', reference: ORDER_A, email: A});
    assert.equal(locked.ok, false); assert.match(!locked.ok ? locked.error : '', /Too many verification attempts/); assert.equal(mock.requests.length, calls); ok();

    clock += 11_000; // token bucket refill (10 requests / 10 s per connection)
    // 7. Taken-over case: lookups refused before any provider call; expiry after 30 minutes.
    mem.cases.get(caseB)!.inboxState = 'taken_over';
    const c2 = mock.requests.length; clearCache();
    r = await ask(caseB, 'payment_history');
    assert.equal(r.ok, false); assert.equal(!r.ok && r.kind, 'refused'); assert.match(!r.ok ? r.error : '', /Case paused/); assert.equal(mock.requests.length, c2); ok();
    mem.cases.get(caseB)!.inboxState = 'open';

    clock += 11_000; // token bucket refill (10 requests / 10 s per connection)
    // 8. Refund review needs a verified, answered lookup on the same case; nothing executes.
    const badRefund = await requestRefundReview(d, {caseHash: caseA, lookupId: randomUUID(), message: 'Please refund my order'});
    assert.equal(badRefund.ok, false); ok();
    const mismatchLookup = mem.lookups.find((l) => l.caseId === mem.cases.get(caseA)!.id && l.outcome === 'mismatch')!;
    assert.equal((await requestRefundReview(d, {caseHash: caseA, lookupId: mismatchLookup.id, message: 'Please refund my order'})).ok, false); ok();
    const answered = await ask(caseA, 'refund_status');
    assert.ok(answered.ok && answered.answer.answer.includes('No refund has been issued by this assistant.'), JSON.stringify(answered)); ok();
    const otherCase = await requestRefundReview(d, {caseHash: caseB, lookupId: answered.ok ? answered.lookupId : '', message: 'Please refund my order'});
    assert.equal(otherCase.ok, false, "another case cannot attach A's lookup"); ok();
    const refund = await requestRefundReview(d, {caseHash: caseA, lookupId: answered.ok ? answered.lookupId : '', message: 'Please refund my order'});
    assert.ok(refund.ok); assert.equal(refund.ok && refund.note, REFUND_NOTE); ok();
    assert.ok(mock.requests.every((q) => q.method === 'GET' || q.url === '/v1/oauth2/token'), 'no write call to the provider, ever'); ok();
    // Forgery with the case token but not the server proof: no lookup row is created or settled.
    const rowsBefore = mem.lookups.length;
    assert.equal((await mem.store.reserve(caseA, 'f'.repeat(64), 'verify', 'paypal', null)).refused, 'not_connected'); ok();
    assert.equal(mem.lookups.length, rowsBefore); ok();
    const pending = await mem.store.reserve(caseA, serverProof(), 'lookup', 'paypal', 'order_status');
    assert.ok(pending.id);
    assert.equal((await mem.store.finish(caseA, 'f'.repeat(64), pending.id!, 'answered', {recordKind: 'order', recordRef: '…901E', recordStatus: 'COMPLETED', amountMinor: 999900, currency: 'USD'}, null)).ok, false); ok();
    assert.equal(mem.lookups.find((l) => l.id === pending.id)!.outcome, 'pending'); ok();
    assert.equal((await requestRefundReview(d, {caseHash: caseA, lookupId: pending.id!, message: 'Please refund my order'})).ok, false, 'forged lookup cannot back a refund review'); ok();

    // 9. Verification expires after 30 minutes.
    clock += 30 * 60_000 + 1; clearCache();
    r = await ask(caseA, 'order_status');
    assert.equal(!r.ok && r.kind, 'verification_required'); ok();

    // 10. Metadata only: no email and no raw reference in any store argument; one audit row per reserve.
    const dump = JSON.stringify(mem.calls) + JSON.stringify(mem.lookups);
    assert.ok(!dump.includes('@'), 'no email in store arguments'); ok();
    for (const ref of RAW_REFS) assert.ok(!dump.includes(ref), `raw reference ${ref.slice(0, 4)}… stored`);
    ok();
    assert.equal(mem.audit.length, mem.lookups.length); ok();
    assert.ok(mem.lookups.filter((l) => l.outcome === 'answered').every((l) => /^…|^[A-Za-z0-9]+[_-]…/.test(l.meta?.recordRef ?? '')), 'record ref is redacted'); ok();

    // 11. Live connection: labelled LIVE.
    const ws2 = randomUUID(); mem.connect(ws2, 'paypal', 'live', cred);
    const caseL = h(); mem.addCase(caseL, ws2);
    clock = Date.parse('2026-10-31T13:00:00Z');
    const vl = await verifyVisitor(d, {caseHash: caseL, provider: 'paypal', reference: 'I-AAAA1111BBBB', email: A});
    assert.ok(vl.ok && vl.mode === 'live'); ok();
    r = await ask(caseL, 'renewal');
    assert.ok(r.ok && r.mode === 'live' && r.answer.answer.endsWith('Read-only LIVE record. No money moved.') && r.answer.cards.every((c) => c.mode === 'live')); ok();
    void conn;
  } finally {
    await mock.close(); clearCache(); resetAllBreakers();
  }

  // 12. Intent table.
  const table: [string, BillingIntent | null][] = [
    ['What is the status of my order?', 'order_status'],
    ['Was I charged twice?', 'order_status'],
    ['Show my payment history.', 'payment_history'],
    ['Why did my payment fail, and will it retry?', 'failed_payment'],
    ['My card was declined', 'failed_payment'],
    ['Can I see my invoice?', 'invoice'],
    ['Where is my receipt?', 'invoice'],
    ['When does my subscription renew?', 'renewal'],
    ['When is my next billing date?', 'renewal'],
    ['What is the status of my refund?', 'refund_status'],
    ['I want a refund', 'refund_status'],
    ['What are your weekend hours?', null],
    ['What is your refund policy?', null],
    ['Do you accept card payments?', null],
    ['How much does the Pro plan cost?', null],
    ['How do I add more seats?', null],
  ];
  for (const [q, want] of table) { assert.equal(billingIntent(q), want, q); ok(); }

  console.log(`PASS verify-billing-isolation: ${n} checks (verification required, mismatch = unknown, per-verification scope and cache, mixed-customer filter, 5-attempt lockout, paused case, refund preconditions, 30-minute expiry, metadata-only store args, LIVE labels, intent table)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
