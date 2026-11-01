// Redaction of provider keys, auth headers, emails and long secrets in every billing message.
import assert from 'node:assert/strict';
import {redact, redactId, safeErrorMessage} from '../lib/billing/core/redact';
import {BillingError} from '../lib/billing/core/types';

let n = 0;
const masked = (input: string, secret: string) => {
  const out = redact(input);
  assert.ok(!out.includes(secret), `leaked ${secret.slice(0, 6)}… in ${out}`);
  n++;
  return out;
};
// Fictional values shaped like each key family, assembled at runtime so secret scanners do not flag them.
const key = (...parts: string[]) => parts.join('_');
masked('key ' + key('sk', 'test', '51Fictional0000000000000000') + ' failed', '51Fictional0000000000000000');
masked('key ' + key('sk', 'live', '51Fictional0000000000000000') + ' failed', '51Fictional0000000000000000');
masked(key('rk', 'test', '51FictionalRestricted00000000'), 'FictionalRestricted');
masked(key('rk', 'live', '51FictionalRestricted00000000'), 'FictionalRestricted');
masked(key('pk', 'test', '51FictionalPublishable0000'), 'FictionalPublishable');
masked('rzp_test_FictionalKey0001', 'FictionalKey0001');
masked('rzp_live_FictionalKey0001', 'FictionalKey0001');
masked('pdl_sdbx_apikey_01fictional0000000000_abc', 'fictional0000000000');
masked('pdl_live_apikey_01fictional0000000000_abc', 'fictional0000000000');
masked('mollie test_FictionalMollieKey000000', 'FictionalMollieKey');
masked('mollie live_FictionalMollieKey000000', 'FictionalMollieKey');
masked('square EAAAFictionalSquareToken0000', 'FictionalSquareToken');
masked('Authorization: Bearer A21AAFictionalToken.value', 'A21AAFictionalToken');
masked('Authorization: Basic QVlmaWN0aW9uYWw6c2VjcmV0', 'QVlmaWN0aW9uYWw6c2VjcmV0');
masked('payer alex.payer@example.test paid', 'alex.payer@example.test');
masked('opaque 0123456789abcdef0123456789abcdef end', '0123456789abcdef0123456789abcdef');
masked('b64 QWxhZGRpbjpvcGVuIHNlc2FtZQQWxhZGRpbjpv end', 'QWxhZGRpbjpvcGVuIHNlc2FtZQQWxhZGRpbjpv');
assert.equal(redact('Order 7AB12345CD678901E is completed'), 'Order 7AB12345CD678901E is completed', 'short ids and prose stay readable'); n++;

assert.equal(redactId('pay_1234567890abcd'), 'pay_…abcd'); n++;
assert.equal(redactId('INV2-AAAA-BBBB-CCCC-DDDD'), 'INV2-…DDDD'); n++;
assert.equal(redactId('7AB12345CD678901E'), '…901E'); n++;
assert.equal(redactId('ch_3MmlLrLkdIwHu7ix0snN0B15'), 'ch_…0B15'); n++;
assert.equal(redactId(''), ''); assert.equal(redactId(null), ''); n++;
assert.ok(redactId('ab').length <= 3); n++;

// Errors carrying provider bodies never surface them.
const withBody = Object.assign(new BillingError('provider_error', {httpStatus: 500}), {body: '{"secret":"sk_live_51Leak","email":"x@example.test"}'});
const m1 = safeErrorMessage(withBody);
assert.ok(!/Leak|example\.test|secret/.test(m1)); assert.ok(m1.length > 10); n++;
const raw = new Error('upstream said: {"card":"4242424242424242","key":"sk_test_51Leak"}');
const m2 = safeErrorMessage(raw);
assert.ok(!/4242|Leak|upstream/.test(m2)); n++;
assert.equal(safeErrorMessage(new BillingError('refused_key', {publicMessage: 'Full live secret keys are refused. Create a restricted key with read permissions.'})), 'Full live secret keys are refused. Create a restricted key with read permissions.'); n++;
for (const code of ['auth_failed', 'not_found', 'rate_limited', 'provider_error', 'timeout', 'circuit_open', 'write_blocked', 'invalid_credential', 'mode_mismatch', 'refused_key', 'unsupported'] as const) {
  assert.ok(safeErrorMessage(new BillingError(code)).length > 10); n++;
}
console.log(`PASS verify-billing-redaction: ${n} checks (key families, Bearer/Basic, emails, long secrets, redactId, error bodies never surfaced)`);
