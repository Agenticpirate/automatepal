// lib/web-push.ts and lib/push-notify.ts without network: RFC 8291 encryption decrypted by an independent
// receiver-side implementation written here (the browser's side of the protocol; also cross-checked against
// Mozilla's http_ece during development), VAPID JWT signature and claims, push-service host allow-list, the
// request sendPush makes, key loading, message text (no visitor text) and result recording.
import assert from 'node:assert/strict';
import {encryptPayload, vapidHeader, sendPush, pushEndpointOk, vapidFromEnv, b64u, fromB64u} from '../lib/web-push';
import {pushMessage, sendToTargets} from '../lib/push-notify';
import type {SupabaseClient} from '@supabase/supabase-js';
let n = 0;
const ok = () => { n++; };
const enc = new TextEncoder();
const buf = (u: Uint8Array) => u as unknown as BufferSource;
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info)}, k, bytes * 8));
}
// Receiver side of RFC 8291 / RFC 8188 (what a browser does).
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, uaPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0), idlen = body[20], asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asKey = await crypto.subtle.importKey('raw', buf(asPublic), {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: asKey}, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: buf(nonce)}, key, buf(ct)));
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return new TextDecoder().decode(plain.slice(0, -1));
}
async function main() {
  const ua = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']) as CryptoKeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = {endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: b64u(uaPublic), auth: b64u(auth)};
  const msg = JSON.stringify(pushMessage('handoff', '11111111-2222-4333-8444-555555555555'));
  const body = await encryptPayload(sub, enc.encode(msg));
  assert.equal(await decrypt(body, ua, uaPublic, auth), msg); ok();
  const body2 = await encryptPayload(sub, enc.encode(msg));
  assert.notDeepEqual(body.slice(0, 16), body2.slice(0, 16), 'fresh salt per message'); ok();
  await assert.rejects(encryptPayload({p256dh: b64u(new Uint8Array(10)), auth: sub.auth}, enc.encode('x')), /Invalid subscription keys/); await assert.rejects(encryptPayload(sub, new Uint8Array(4000)), /too large/); ok();
  // VAPID.
  const kp = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d!;
  const v = {publicKey: pub, privateKey: priv, subject: 'mailto:ops@example.test'};
  const h = await vapidHeader(sub.endpoint, v, Date.UTC(2026, 10, 9)); const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
  assert.ok(await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, kp.publicKey, buf(fromB64u(m[3])), buf(enc.encode(m[1] + '.' + m[2]))), 'ES256 signature'); ok();
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64u(m[2]))), {aud: 'https://fcm.googleapis.com', exp: Date.UTC(2026, 10, 9) / 1000 + 43200, sub: 'mailto:ops@example.test'}); assert.equal(m[4], pub); ok();
  // Endpoint allow-list.
  for (const good of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-bl2p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/x']) assert.ok(pushEndpointOk(good), good);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://169.254.169.254/x', 'https://user@fcm.googleapis.com/x']) assert.ok(!pushEndpointOk(bad), bad);
  ok();
  // The request.
  const seen: {url: string; init: RequestInit}[] = [];
  const f = (async (url: string, init: RequestInit) => { seen.push({url, init}); return new Response(null, {status: 201}); }) as unknown as typeof fetch;
  assert.equal(await sendPush(sub, {title: 't'}, v, f), 201);
  const hd = seen[0].init.headers as Record<string, string>;
  assert.equal(seen[0].url, sub.endpoint); assert.equal(hd['Content-Encoding'], 'aes128gcm'); assert.equal(hd.TTL, '86400'); assert.match(hd.Authorization, /^vapid t=.+, k=/); assert.equal(seen[0].init.redirect, 'manual'); ok();
  assert.equal(await sendPush({...sub, endpoint: 'https://evil.example/x'}, {}, v, f), 0); assert.equal(seen.length, 1, 'refused endpoint never fetched'); ok();
  // Keys from env.
  assert.equal(vapidFromEnv({}), null); assert.equal(vapidFromEnv({WEB_PUSH_PUBLIC_KEY: 'abc', WEB_PUSH_PRIVATE_KEY: priv}), null);
  assert.equal(vapidFromEnv({WEB_PUSH_PUBLIC_KEY: pub, WEB_PUSH_PRIVATE_KEY: priv})?.subject, 'mailto:support@automatepal.com'); ok();
  // Messages: no visitor text; links stay inside the app.
  const hm = pushMessage('handoff', '11111111-2222-4333-8444-555555555555');
  assert.equal(hm.url, '/tickets?ticket=11111111-2222-4333-8444-555555555555'); assert.match(hm.title, /asked for a person/); assert.equal(pushMessage('lead', null).url, '/tickets'); ok();
  // Results recorded per device (gone devices reported to the database).
  const recorded: unknown[] = [];
  const db = {rpc: async (_: string, a: unknown) => { recorded.push(a); return {data: null, error: null}; }} as unknown as SupabaseClient;
  const f2 = (async (url: string) => new Response(null, {status: url.endsWith('gone') ? 410 : 201})) as unknown as typeof fetch;
  const r = await sendToTargets(db, [{...sub, id: 'a'}, {...sub, endpoint: sub.endpoint + 'gone', id: 'b'}], {title: 'x'}, v, f2);
  assert.deepEqual(r, {sent: 1, failed: 1}); assert.deepEqual(recorded.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))), [{p_id: 'a', p_status: 201}, {p_id: 'b', p_status: 410}]); ok();
  console.log(`PASS push: ${n} checks; RFC 8291 encryption decrypted by an independent receiver, fresh salt, VAPID ES256 signature and claims, push-service allow-list, request headers, refused endpoints never fetched, key loading, messages without visitor text, per-device results.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
