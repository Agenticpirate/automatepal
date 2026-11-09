// Phase 5 security fixes, without network: internal-call marker cannot be forged, client IP trust on Cloudflare,
// development-only fallbacks (frame-grant secret, mock PayPal host) are off unless NODE_ENV=development.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {internalHeaders, isInternal, INTERNAL_HEADER} from '../lib/internal-call';
import {clientIp, signFrame} from '../lib/widget-frame';
let n = 0;
const ok = () => { n++; };
const env = process.env as Record<string, string | undefined>;
async function main() {
  assert.ok(isInternal(new Headers(internalHeaders()))); ok();
  assert.ok(!isInternal(new Headers())); assert.ok(!isInternal(new Headers({[INTERNAL_HEADER]: 'x'.repeat(64)}))); assert.ok(!isInternal(new Headers({[INTERNAL_HEADER]: '1'}))); ok();
  // Cloudflare: X-Forwarded-For is ignored (anyone can send it); elsewhere it is the fallback.
  const h = new Headers({'x-forwarded-for': '6.6.6.6'});
  assert.equal(clientIp(h, {APP_PLATFORM: 'cloudflare'}), 'unknown');
  assert.equal(clientIp(new Headers({'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '6.6.6.6'}), {APP_PLATFORM: 'cloudflare'}), '1.2.3.4');
  assert.equal(clientIp(h, {}), '6.6.6.6'); ok();
  // Frame grants: no secret and not development → no grant (so /help is framed by this app only).
  const saved = {s: env.WIDGET_FRAME_SECRET, e: env.NODE_ENV};
  delete env.WIDGET_FRAME_SECRET;
  for (const mode of [undefined, 'test', 'production']) { if (mode) env.NODE_ENV = mode; else delete env.NODE_ENV; assert.equal(await signFrame('a'.repeat(64), 'https://shop.example'), null, String(mode)); }
  env.NODE_ENV = 'development'; assert.ok(await signFrame('a'.repeat(64), 'https://shop.example'), 'development fallback'); ok();
  env.NODE_ENV = saved.e; if (saved.s) env.WIDGET_FRAME_SECRET = saved.s;
  // Mock PayPal host is refused outside development (lib/paypal.ts throws at load).
  const load = (nodeEnv: 'development' | 'production' | 'test') => spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./lib/paypal.ts').then(()=>console.log('LOADED'),e=>console.log('REFUSED',e.message))"], {env: {...process.env, NODE_ENV: nodeEnv, PAYPAL_API_BASE: 'http://127.0.0.1:8790'}, encoding: 'utf8'}).stdout;
  assert.match(load('production'), /REFUSED Only PayPal sandbox/); assert.match(load('test'), /REFUSED/); assert.match(load('development'), /LOADED/); ok();
  console.log(`PASS phase 5 hardening units: ${n} checks; internal marker unforgeable, Cloudflare IP trust, dev-only frame secret, mock PayPal refused outside development.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
