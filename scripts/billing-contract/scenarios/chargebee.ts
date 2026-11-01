import assert from 'node:assert/strict';
import {one, type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const KEY = 'test_FictionalChargebeeReadOnlyKey0001';
export const scenario: Scenario = {
  provider: 'chargebee',
  cred: {apiKey: KEY},
  config: {site: 'fictional-test'},
  liveConfig: {site: 'fictional'},
  hosts: {test: 'https://fictional-test.chargebee.com/api/v2', live: 'https://fictional.chargebee.com/api/v2'},
  verify: [
    {ref: 'AP-INV-1001', email: 'ALEX.payer@example.test', expect: 'verified', scopeIds: ['AP-INV-1001'], customerId: 'cbA111'},
    {ref: 'AP-INV-1001', email: B, expect: 'mismatch'},
    {ref: 'AP-INV-2001', email: B, expect: 'verified', customerId: 'cbB222'},
    {ref: 'subA111', email: A, expect: 'verified', scopeIds: ['subA111'], customerId: 'cbA111'},
    {ref: 'subA111', email: B, expect: 'mismatch'},
    {ref: 'NOPE-404', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'AP-INV-1001', email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'paid'); assert.equal(r[0].amountMinor, 4900); }},
    {ref: 'AP-INV-1001', email: A, intent: 'payment_history', expect: (r) => assert.deepEqual(r.map((x) => x.id), ['txn_A111', 'txn_A112'])},
    {ref: 'AP-INV-1001', email: A, intent: 'failed_payment', expect: (r) => {
      assert.deepEqual(one(r, (x) => x.id === 'AP-INV-1002', 'due invoice').failure, {message: 'invoice payment due', attemptCount: 0, nextRetryAt: '2026-11-05T00:00:00.000Z'});
      assert.equal(one(r, (x) => x.id === 'txn_A112', 'failed txn').failure?.message, 'Card declined');
    }},
    {ref: 'AP-INV-1001', email: A, intent: 'invoice', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.status]), [['AP-INV-1001', 'paid'], ['AP-INV-1002', 'payment_due']])},
    {ref: 'subA111', email: A, intent: 'renewal', expect: (r) => assert.equal(r[0].renewalAt, new Date(1793923200 * 1000).toISOString())},
    {ref: 'AP-INV-1001', email: A, intent: 'refund_status', expect: (r) => assert.deepEqual(r.map((x) => [x.id, x.status, x.amountMinor, x.parentRef]), [['CN-A1', 'refunded', 1000, 'AP-INV-1001']])},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: KEY}, config: {site: 'fictional-test'}, ok: true},
    {mode: 'live', cred: {apiKey: 'live_FictionalChargebeeReadOnlyKey0001'}, config: {site: 'fictional'}, ok: true},
    {mode: 'test', cred: {apiKey: KEY}, config: {site: 'fictional'}, ok: false, code: 'mode_mismatch'},
    {mode: 'live', cred: {apiKey: KEY}, config: {site: 'fictional-test'}, ok: false, code: 'mode_mismatch'},
    {mode: 'test', cred: {apiKey: KEY}, config: {site: 'evil.example.test/x'}, ok: false, code: 'invalid_credential'},
    {mode: 'test', cred: {apiKey: 'short'}, config: {site: 'fictional-test'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/credit_notes', body: 'reference_invoice_id=AP-INV-1001'},
  mixed: {ref: 'AP-INV-1001', email: A, intent: 'payment_history', forbiddenIds: ['txn_B221']},
  extra: async ({mock, adapter}) => {
    mock.setMode('mixed_customers');
    const a = adapter();
    const v = await a.verifyCustomer('AP-INV-1001', A);
    if (v.status !== 'verified') throw Error('setup');
    assert.deepEqual((await a.lookup(v.scope, 'refund_status')).map((x) => x.id), ['CN-A1'], "another customer's credit note is dropped");
    return 1;
  },
};
