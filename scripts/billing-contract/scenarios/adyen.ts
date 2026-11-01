import assert from 'node:assert/strict';
import {type Scenario} from '../scenario';

const A = 'alex.payer@example.test', B = 'blair.payer@example.test';
const KEY = 'AQEyhmfxFictionalAdyenKey0000000000000000';
export const scenario: Scenario = {
  provider: 'adyen',
  cred: {apiKey: KEY},
  config: {merchantAccount: 'FictionalECOM'},
  liveConfig: {merchantAccount: 'FictionalECOM', livePrefix: '1797a841fbb37ca7-FictionalDemo'},
  hosts: {test: 'https://checkout-test.adyen.com/v71', live: 'https://1797a841fbb37ca7-fictionaldemo-checkout-live.adyenpayments.com/checkout/v71'},
  hostsNotInSpec: ['1797a841fbb37ca7-fictionaldemo-checkout-live.adyenpayments.com'],
  verify: [
    {ref: 'PL61C53A8B97E6915A', email: 'ALEX.payer@example.test', expect: 'verified', scopeIds: ['PL61C53A8B97E6915A']},
    {ref: 'pl61c53a8b97e6915a', email: A, expect: 'verified'},
    {ref: 'PL61C53A8B97E6915A', email: B, expect: 'mismatch'},
    {ref: 'PL7B2D44E1A0C3F881', email: B, expect: 'verified'},
    {ref: 'PL9C9C9C9C9C9C9C9C', email: A, expect: 'not_found'},
    {ref: 'PLZZZZZZZZZZZZZZZZ', email: A, expect: 'not_found'},
  ],
  lookups: [
    {ref: 'PL61C53A8B97E6915A', email: A, intent: 'order_status', expect: (r) => { assert.equal(r[0].status, 'completed'); assert.equal(r[0].amountMinor, 4900); assert.equal(r[0].currency, 'EUR'); assert.equal(r[0].displayRef, 'AP-ORDER-2001'); }},
    {ref: 'PL61C53A8B97E6915A', email: A, intent: 'invoice', expect: (r) => assert.equal(r[0].hostedUrl, 'https://test.adyen.link/PL61C53A8B97E6915A')},
  ],
  credentialRules: [
    {mode: 'test', cred: {apiKey: KEY}, config: {merchantAccount: 'FictionalECOM'}, ok: true},
    {mode: 'live', cred: {apiKey: KEY}, config: {livePrefix: '1797a841fbb37ca7-FictionalDemo'}, ok: true},
    {mode: 'live', cred: {apiKey: KEY}, config: {}, ok: false, code: 'invalid_credential'},
    {mode: 'live', cred: {apiKey: KEY}, config: {livePrefix: 'evil.example.test/x'}, ok: false, code: 'invalid_credential'},
    {mode: 'test', cred: {apiKey: 'not-an-adyen-key-000000000000'}, ok: false, code: 'invalid_credential'},
  ],
  writeProbe: {method: 'POST', path: '/v71/payments/PL61C53A8B97E6915A/refunds', body: '{}'},
  mixed: {ref: 'PL61C53A8B97E6915A', email: A, intent: 'order_status', forbiddenIds: ['PL7B2D44E1A0C3F881'], verifyRejected: true},
};
