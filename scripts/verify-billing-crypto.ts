// Billing credential encryption at rest: AES-256-GCM with AAD, key ids, rotation, server proof.
// Uses throwaway keys generated in-process; never reads .env.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {activeKeyId, credentialAad, decryptCredential, encryptCredential, encryptionReady, keyIdOf, needsRotation, openScope, proofHash, sealScope, serverProof} from '../lib/billing/core/crypto';

const k1 = randomBytes(32).toString('base64'), k2 = randomBytes(32).toString('base64');
const set = (keys: string | undefined, kid: string | undefined, secret: string | undefined) => {
  for (const [k, v] of [['BILLING_ENCRYPTION_KEYS', keys], ['BILLING_ENCRYPTION_ACTIVE_KID', kid], ['BILLING_RPC_SECRET', secret]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};
const secret = randomBytes(32).toString('hex');
let n = 0;
const ok = () => n++;

// Missing or invalid configuration refuses with one fixed message.
set(undefined, undefined, undefined);
assert.throws(() => encryptCredential('x', 'a'), /Billing encryption is not configured on the server\./); ok();
assert.equal(encryptionReady(), false); ok();
set('k1:' + randomBytes(16).toString('base64'), 'k1', secret);
assert.throws(() => activeKeyId(), /not configured/); ok();
set(`k1:${k1}`, 'k9', secret);
assert.throws(() => activeKeyId(), /not configured/); ok();
set(`K1:${k1}`, 'K1', secret);
assert.throws(() => activeKeyId(), /not configured/); ok();
set(`k1:${k1}`, 'k1', 'short');
assert.equal(encryptionReady(), false); ok();
assert.throws(() => serverProof(), /not configured/); ok();

set(`k1:${k1}`, 'k1', secret);
assert.equal(encryptionReady(), true); ok();
const plain = JSON.stringify({clientId: 'AYfictionalclientid0000000001', clientSecret: 'EFfictionalsecret00000000000000001'});
const aad = credentialAad('11111111-1111-4111-8111-111111111111', 'paypal', 'test');
const a = encryptCredential(plain, aad), b = encryptCredential(plain, aad);
assert.equal(decryptCredential(a.blob, aad), plain); ok();
assert.match(a.blob, /^v2\.k1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); ok();
assert.equal(a.keyId, 'k1'); assert.equal(keyIdOf(a.blob), 'k1'); ok();
assert.notEqual(a.blob, b.blob, 'fresh IV per encryption'); ok();
assert.notEqual(a.blob.split('.')[2], b.blob.split('.')[2]); ok();
assert.ok(!a.blob.includes('fictionalsecret') && !Buffer.from(a.blob.split('.')[4], 'base64url').toString('utf8').includes('fictional'), 'blob never contains plaintext'); ok();

// Tampering with any part, the AAD, or the key id fails closed.
const parts = a.blob.split('.');
const flip = (s: string) => { const buf = Buffer.from(s, 'base64url'); buf[0] ^= 1; return buf.toString('base64url'); };
for (const i of [2, 3, 4]) {
  const t = [...parts]; t[i] = flip(t[i]);
  assert.throws(() => decryptCredential(t.join('.'), aad), /unreadable/); ok();
}
assert.throws(() => decryptCredential(a.blob, credentialAad('22222222-2222-4222-8222-222222222222', 'paypal', 'test')), /unreadable/); ok();
assert.throws(() => decryptCredential(a.blob, credentialAad('11111111-1111-4111-8111-111111111111', 'paypal', 'live')), /unreadable/); ok();
assert.throws(() => decryptCredential(['v2', 'k2', ...parts.slice(2)].join('.'), aad), /unknown key id/); ok();
assert.throws(() => decryptCredential('v1.' + parts.slice(1).join('.'), aad), /unreadable/); ok();

// Rotation: add k2 and make it active. Old k1 blobs still decrypt; new blobs use k2.
set(`k1:${k1},k2:${k2}`, 'k2', secret);
assert.equal(decryptCredential(a.blob, aad), plain); ok();
assert.equal(needsRotation('k1'), true); assert.equal(needsRotation('k2'), false); ok();
const rotated = encryptCredential(decryptCredential(a.blob, aad), aad);
assert.equal(rotated.keyId, 'k2'); assert.equal(decryptCredential(rotated.blob, aad), plain); ok();
// Same key material under a different kid label is a different key id, not a silent alias.
set(`k2:${k2}`, 'k2', secret);
assert.throws(() => decryptCredential(a.blob, aad), /unknown key id/); ok();
set(`k1:${k1},k1:${k2}`, 'k1', secret);
assert.throws(() => activeKeyId(), /not configured/, 'duplicate kid refused'); ok();

// Server proof: stable per secret, changes with the secret, hash is 64 hex.
set(`k1:${k1}`, 'k1', secret);
const p1 = serverProof();
assert.equal(serverProof(), p1); assert.match(proofHash(p1), /^[a-f0-9]{64}$/); ok();
set(`k1:${k1}`, 'k1', randomBytes(32).toString('hex'));
assert.notEqual(serverProof(), p1); ok();
// Rotating the encryption key does not change the proof.
set(`k1:${k1},k2:${k2}`, 'k2', secret);
assert.equal(serverProof(), p1); ok();

// Sealed verification scope: bound to the case hash and provider.
const scope = {provider: 'paypal' as const, mode: 'test' as const, customerId: null, recordIds: ['7AB12345CD678901E'], recordKinds: {'7AB12345CD678901E': 'order' as const}};
const caseHash = 'a'.repeat(64);
const sealed = sealScope(scope, caseHash);
assert.ok(!JSON.stringify(sealed).includes('7AB12345CD678901E')); ok();
assert.deepEqual(openScope(sealed, caseHash, 'paypal'), scope); ok();
assert.equal(openScope(sealed, 'b'.repeat(64), 'paypal'), null); ok();
assert.equal(openScope(sealed, caseHash, 'stripe'), null); ok();
assert.equal(openScope({sealed: 'garbage'}, caseHash, 'paypal'), null); ok();
assert.ok(JSON.stringify(sealed).length < 2000, 'fits the 2000-byte scope CHECK'); ok();

console.log(`PASS verify-billing-crypto: ${n} checks (round-trip, fresh IV, tamper/AAD/kid refusal, rotation, needsRotation, fixed-message refusal, stable proof, sealed scope)`);
