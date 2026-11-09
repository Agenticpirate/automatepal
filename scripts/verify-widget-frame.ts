// lib/widget-frame.ts: signed frame grants for /help. No network or database.
import assert from 'node:assert/strict';
import {signFrame, verifyFrame, frameOrigin, WIDGET_KEY, CASE_TOKEN, clientIp} from '../lib/widget-frame';
let n = 0;
const ok = () => { n++; };
const env = process.env as Record<string, string | undefined>;
async function main() {
  const token = 'a'.repeat(64), other = 'b'.repeat(64), shop = 'https://shop.example', now = Date.UTC(2026, 10, 9);
  env.WIDGET_FRAME_SECRET = 's'.repeat(40);
  const g = await signFrame(token, shop, now);
  assert.ok(g && g.origin === shop && /^[a-f0-9]{64}$/.test(g.sig)); ok();
  assert.equal(await verifyFrame(token, shop, String(g!.exp), g!.sig, now), shop, 'valid grant'); ok();
  assert.equal(await verifyFrame(other, shop, String(g!.exp), g!.sig, now), null, 'other token'); ok();
  assert.equal(await verifyFrame(token, 'https://evil.example', String(g!.exp), g!.sig, now), null, 'other origin'); ok();
  assert.equal(await verifyFrame(token, shop, String(g!.exp + 1), g!.sig, now), null, 'changed expiry'); ok();
  assert.equal(await verifyFrame(token, shop, String(g!.exp), g!.sig.replace(/^./, c => c === '0' ? '1' : '0'), now), null, 'tampered signature'); ok();
  assert.equal(await verifyFrame(token, shop, String(g!.exp), g!.sig, now + 25 * 3600e3), null, 'expired'); ok();
  assert.equal(await verifyFrame(token, shop, String(g!.exp + 7 * 86400), g!.sig, now), null, 'expiry too far ahead'); ok();
  for (const [t, o, e, s] of [[null, shop, String(g!.exp), g!.sig], [token, null, String(g!.exp), g!.sig], [token, shop, 'x', g!.sig], [token, shop, String(g!.exp), null], [token, shop + '/path', String(g!.exp), g!.sig], ['short', shop, String(g!.exp), g!.sig]] as const) {
    assert.equal(await verifyFrame(t, o, e, s, now), null); ok();
  }
  env.WIDGET_FRAME_SECRET = 't'.repeat(40);
  assert.equal(await verifyFrame(token, shop, String(g!.exp), g!.sig, now), null, 'secret rotation invalidates grants'); ok();
  // Production without a secret: no grants at all (so /help is framed by this app only).
  const nodeEnv = env.NODE_ENV; env.WIDGET_FRAME_SECRET = ''; env.NODE_ENV = 'production';
  assert.equal(await signFrame(token, shop, now), null); ok();
  env.WIDGET_FRAME_SECRET = 'short'; assert.equal(await signFrame(token, shop, now), null, 'secret under 32 chars refused'); ok();
  env.NODE_ENV = nodeEnv;
  assert.equal(frameOrigin('https://a.example'), 'https://a.example'); assert.equal(frameOrigin('https://a.example/'), null); assert.equal(frameOrigin('javascript:alert(1)'), null); ok();
  assert.ok(WIDGET_KEY.test('pk_live_' + 'A1b2'.repeat(6))); assert.ok(!WIDGET_KEY.test('pk_live_' + 'A'.repeat(23))); assert.ok(!WIDGET_KEY.test('sk_live_' + 'A'.repeat(24))); assert.ok(CASE_TOKEN.test(token)); ok();
  assert.equal(clientIp(new Headers({'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8'})), '1.2.3.4'); assert.equal(clientIp(new Headers({'x-forwarded-for': '5.6.7.8, 9.9.9.9'})), '5.6.7.8'); ok();
  console.log(`PASS widget frame grants: ${n} checks; bound to token, origin and expiry; tampering, expiry, rotation and malformed input refused; no grants in production without a 32+ character secret.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
