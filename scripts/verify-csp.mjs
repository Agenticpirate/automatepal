// CSP gate (Chrome, production build): every page gets a nonce-based Content-Security-Policy with
// 'strict-dynamic', a fresh nonce per response, nonces on every executable script, the right
// frame-ancestors rule (none on the /help widget frame, 'self' elsewhere), the other security headers, a
// hydrated React tree, and ZERO CSP violations (securitypolicyviolation events and console reports).
// Run `npm run build` first. Uses the open demo fixtures so app pages render their populated states.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
const PORT = 3271, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env}});
export const PAGES = ['/', '/pricing', '/security', '/privacy', '/terms', '/status', '/contact', '/docs', '/login', '/help', '/merchant-demo',
  '/dashboard', '/owner', '/tickets', '/billing', '/support', '/leads', '/history', '/knowledge', '/team', '/setup', '/integrations', '/workspace',
  '/proof', '/tax', '/operations', '/sandbox-catalog', '/invite', '/preview/video',
  '/legal/dpa', '/legal/subprocessors', '/legal/delete-account', '/this-page-does-not-exist'];
let n = 0; const ok = () => n++;
async function waitServer() { const dl = Date.now() + 90000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/api/status'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
try {
  await waitServer();
  // Header checks without a browser.
  const a = await fetch(BASE + '/'), b = await fetch(BASE + '/');
  const nonceOf = (h) => (h.match(/'nonce-([A-Za-z0-9+/=]+)'/) ?? [])[1];
  const ca = a.headers.get('content-security-policy') ?? '', cb = b.headers.get('content-security-policy') ?? '';
  assert.match(ca, /script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'/, ca); ok();
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(ca) && !/'unsafe-eval'/.test(ca), 'no unsafe-inline or unsafe-eval for scripts'); ok();
  assert.notEqual(nonceOf(ca), nonceOf(cb), 'fresh nonce per response'); ok();
  assert.match(ca, /object-src 'none'/); assert.match(ca, /base-uri 'self'/); assert.match(ca, /frame-ancestors 'self'/); ok();
  assert.match(ca, /connect-src 'self' https?:\/\/[a-z0-9.*:-]+ wss?:\/\/[a-z0-9.*:-]+;/, 'connect-src limited to the app and Supabase'); ok();
  for (const h of ['x-content-type-options', 'referrer-policy', 'permissions-policy', 'strict-transport-security', 'x-frame-options']) assert.ok(a.headers.get(h), h);
  ok();
  const help = await fetch(BASE + '/help');
  assert.ok(!/frame-ancestors/.test(help.headers.get('content-security-policy') ?? 'x'), '/help stays embeddable'); assert.equal(help.headers.get('x-frame-options'), null); ok();
  const api = await fetch(BASE + '/api/status');
  assert.ok(api.headers.get('content-security-policy'), 'API responses keep a CSP header'); ok();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
    await ctx.addInitScript(() => { window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    const failures = [];
    for (const path of PAGES) {
      const p = await ctx.newPage(); const reports = [];
      p.on('console', (m) => { if (/Content.Security.Policy|Refused to (execute|load|apply|connect|frame)/i.test(m.text())) reports.push(m.text().slice(0, 200)); });
      const res = await p.goto(BASE + path, {waitUntil: 'load'});
      assert.ok(res, path);
      assert.match(res.headers()['content-security-policy'] ?? '', /'strict-dynamic'/, `${path} CSP`);
      await p.waitForLoadState('networkidle', {timeout: 15000}).catch(() => {});
      await p.waitForTimeout(400);
      const state = await p.evaluate(() => ({
        v: window.__cspv,
        hydrated: Object.keys(document).some((k) => k.startsWith('_reactListening')),
        unnonced: [...document.querySelectorAll('script')].filter((s) => (!s.type || /javascript|module/.test(s.type)) && !s.nonce && !s.getAttribute('nonce')).length,
      }));
      if (state.v.length || reports.length) failures.push(`${path}: ${[...state.v, ...reports].join(' | ')}`);
      assert.ok(state.hydrated, `${path} did not hydrate (scripts blocked?)`);
      assert.equal(state.unnonced, 0, `${path} has executable scripts without a nonce`);
      ok();
      await p.close();
    }
    assert.deepEqual(failures, [], 'CSP violations:\n' + failures.join('\n')); ok();
    console.log(`PASS CSP: ${n} checks; ${PAGES.length} pages with a per-request nonce and 'strict-dynamic', no unsafe-inline/eval for scripts, frame-ancestors 'self' (none on /help), connect-src limited to the app and Supabase, every page hydrated, every executable script nonced, zero CSP violations.`);
  } finally { await browser.close(); }
} finally { server.kill(); }
