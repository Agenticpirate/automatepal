/* Web Push sender (Phase 3, mobile inbox). Standard Web Push with Web Crypto only, so it runs on Node and on
   Cloudflare Workers without a dependency:
   - Payload encryption: RFC 8291 (aes128gcm content coding, RFC 8188), one record.
   - Sender authentication: VAPID (RFC 8292), an ES256 JWT for the push service's origin.
   Keys: WEB_PUSH_PUBLIC_KEY (uncompressed P-256 point, base64url, 65 bytes) and WEB_PUSH_PRIVATE_KEY (the
   private scalar d, base64url, 32 bytes); scripts/generate-vapid-keys.mjs makes a pair. WEB_PUSH_SUBJECT is
   a mailto: or https: contact for push services (default mailto:support@automatepal.com).
   Endpoints come from browsers, so only the major push services' hosts are ever contacted. */
const enc = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - t.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const buf = (u: Uint8Array) => u as unknown as BufferSource;

/* Known push services (Chrome/Android, Firefox, Edge/Windows, Safari/iOS). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/];
export function pushEndpointOk(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  try { const u = new URL(endpoint); return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some(h => h.test(u.hostname)); } catch { return false; }
}
export type PushSubscriptionKeys = {endpoint: string; p256dh: string; auth: string};
export type VapidKeys = {publicKey: string; privateKey: string; subject: string};
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY, privateKey = env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  try { if (fromB64u(publicKey).length !== 65 || fromB64u(privateKey).length !== 32) return null; } catch { return null; }
  const subject = env.WEB_PUSH_SUBJECT && /^(mailto:|https:\/\/)/.test(env.WEB_PUSH_SUBJECT) ? env.WEB_PUSH_SUBJECT : 'mailto:support@automatepal.com';
  return {publicKey, privateKey, subject};
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info)}, key, bytes * 8));
}
/* RFC 8291: encrypt one message for a subscription. The salt and the sender key pair are random per message
   (tests may pass them). Returns the full aes128gcm body: header (salt, record size, key id) + ciphertext. */
export async function encryptPayload(sub: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>, payload: Uint8Array, test?: {salt: Uint8Array; senderKeys: CryptoKeyPair}): Promise<Uint8Array> {
  const uaPublic = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw Error('Invalid subscription keys');
  if (payload.length > 3000) throw Error('Payload too large');
  const sender = test?.senderKeys ?? await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: uaKey}, sender.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = test?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: buf(nonce)}, key, buf(concat(payload, new Uint8Array([2])))));
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}
/* RFC 8292: VAPID Authorization header for an endpoint's origin, valid 12 hours. */
export async function vapidHeader(endpoint: string, v: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromB64u(v.publicKey);
  const key = await crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true}, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const body = b64u(enc.encode(JSON.stringify({aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject})));
  const sig = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, buf(enc.encode(`${head}.${body}`))));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}
/* Sends one notification. Returns the push service's HTTP status (0 on network error or refused endpoint).
   404 and 410 mean the subscription is gone and should be deleted. */
export async function sendPush(sub: PushSubscriptionKeys, message: unknown, v: VapidKeys, f: typeof fetch = fetch): Promise<number> {
  if (!pushEndpointOk(sub.endpoint)) return 0;
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
    const r = await f(sub.endpoint, {method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000), body: buf(body) as BodyInit,
      headers: {Authorization: await vapidHeader(sub.endpoint, v), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high'}});
    return r.status;
  } catch { return 0; }
}
