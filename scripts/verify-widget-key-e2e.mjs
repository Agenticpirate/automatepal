// End to end: a permanent widget key on a merchant site (another origin), against a LOCAL app server wired to
// the LOCAL Supabase. Usage (app started with the local Supabase URL, anon key and service-role key in env):
//   E2E_APP=http://localhost:3100 LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//   node scripts/verify-widget-key-e2e.mjs
// Seeds one key, allowed origin and published exact answer for the first synthetic user, and removes them after.
import assert from 'node:assert/strict';
import pg from 'pg';
import {chromium} from '@playwright/test';
const APP = process.env.E2E_APP, DB = process.env.LOCAL_DATABASE_URL;
if (!APP || !DB) { console.error('Set E2E_APP and LOCAL_DATABASE_URL.'); process.exit(1); }
for (const u of [APP, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
const OWNER = '00000000-0000-4000-8000-000000000001', KEY = 'pk_test_E2eWidgetKey000000000000', SHOP = 'https://shop.example', EVIL = 'https://evil.example';
const Q = 'What are your support hours?', A = 'Our team answers Monday to Friday, 9am to 5pm IST.';
const db = new pg.Client({connectionString: DB});
let n = 0;
const ok = () => { n++; };
const cases = async () => Number((await db.query("select count(*) from support_cases where user_id=$1 and source='widget'", [OWNER])).rows[0].count);
const page = (origin) => `<!doctype html><html><body><h1>${origin}</h1><script src="${APP}/widget.js" data-bot="${KEY}" async></script></body></html>`;
async function seed() {
  await db.query('begin');
  await db.query("select set_config('app.widget_key_rpc','1',true)");
  await db.query(`insert into widget_settings(user_id,label,public_key,key_active,controls) values($1,'Shop help',$2,true,$3)
    on conflict(user_id) do update set label='Shop help',public_key=$2,key_active=true,controls=$3`, [OWNER, KEY, JSON.stringify({allowedOrigins: [SHOP]})]);
  await db.query('insert into custom_responses(user_id,question,answer,published) values($1,$2,$3,true) on conflict do nothing', [OWNER, Q, A]);
  await db.query('commit');
}
async function cleanup() {
  await db.query("delete from support_cases where user_id=$1 and source='widget'", [OWNER]);
  await db.query('delete from custom_responses where user_id=$1 and question=$2', [OWNER, Q]);
  await db.query('begin'); await db.query("select set_config('app.widget_key_rpc','1',true)");
  await db.query('delete from widget_settings where user_id=$1', [OWNER]); await db.query('commit');
}
async function main() {
  await db.connect();
  await cleanup(); await seed();
  // The test 'merchant' is a public https origin calling a localhost app: turn off Chromium's local-network
  // blocking for this test only (a real install calls a public app origin).
  const browser = await chromium.launch({args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults']});
  try {
    const ctx = await browser.newContext();
    await ctx.route(`${SHOP}/**`, r => r.fulfill({contentType: 'text/html', body: page(SHOP)}));
    await ctx.route(`${EVIL}/**`, r => r.request().url().endsWith('/frame') ? r.fulfill({contentType: 'text/html', body: '<iframe id="f" src="about:blank"></iframe>'}) : r.fulfill({contentType: 'text/html', body: page(EVIL)}));
    const p = await ctx.newPage();
    if (process.env.E2E_DEBUG) p.on('console', m => console.log('[shop]', m.type(), m.text()));
    const before = await cases();
    await p.goto(`${SHOP}/products`);
    const button = p.locator('#automatepal-billing-widget button');
    await button.waitFor({timeout: 20000});
    assert.equal(await button.innerText(), 'Shop help', 'no demo suffix with a key'); ok();
    assert.equal(await cases(), before, 'no conversation before the visitor opens the chat'); ok();
    await button.click();
    const frameEl = p.locator('#automatepal-billing-widget iframe');
    await p.waitForFunction(() => document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('iframe')?.src.includes('/help?'), null, {timeout: 20000});
    const src = await frameEl.getAttribute('src');
    const u = new URL(src);
    assert.ok(/^[a-f0-9]{64}$/.test(u.searchParams.get('token')) && u.searchParams.get('embed') === SHOP && /^[a-f0-9]{64}$/.test(u.searchParams.get('fsig')), 'panel gets a token and a signed frame grant'); ok();
    const token = u.searchParams.get('token');
    assert.equal(await cases(), before + 1, 'one conversation opened'); ok();
    const frame = p.frameLocator('#automatepal-billing-widget iframe');
    await frame.getByRole('heading', {name: /Clear answers/}).waitFor({timeout: 30000});
    ok(); // /help rendered inside shop.example: frame-ancestors allowed it
    const helpCsp = (await (await fetch(src)).headers.get('content-security-policy')) ?? '';
    assert.match(helpCsp, /frame-ancestors 'self' https:\/\/shop\.example/); ok();
    const ans = await (await fetch(`${APP}/api/support`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'answer', token, question: Q, source: 'widget'})})).json();
    assert.equal(ans.answer, A, 'exact owner answer through the widget conversation'); ok();
    const view = await (await fetch(`${APP}/api/support?token=${token}`)).json();
    assert.equal(view.case.source, 'widget'); assert.equal(view.case.billing, null, 'no fictional order card'); ok();
    // Same visitor, new page load: the saved conversation is reused.
    await p.reload(); await button.waitFor(); await button.click();
    await p.waitForFunction(() => document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('iframe')?.src.includes('/help?'));
    assert.equal(new URL(await frameEl.getAttribute('src')).searchParams.get('token'), token, 'token reused'); assert.equal(await cases(), before + 1, 'no second conversation'); ok();
    // reset() forgets the conversation; the next open starts a new one.
    await p.evaluate(() => { window.AutomatePal.reset(); window.AutomatePal.open(); });
    await p.waitForFunction((t) => { const s = document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('iframe')?.src ?? ''; return s.includes('/help?') && !s.includes(t); }, token);
    assert.equal(await cases(), before + 2, 'reset starts a new conversation'); ok();
    // A site that is not allowed gets no widget and cannot open conversations with the key.
    const e = await ctx.newPage(); await e.goto(`${EVIL}/x`); await e.waitForTimeout(2500);
    assert.equal(await e.locator('#automatepal-billing-widget').count(), 0, 'no widget on a site that is not allowed'); ok();
    const forged = await e.evaluate(async ([app, key]) => (await fetch(app + '/api/widget/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key, path: '/'})})).status, [APP, KEY]);
    assert.equal(forged, 403, 'session refused from a site that is not allowed'); ok();
    // Framing a real conversation from that site, without a valid grant, is blocked by frame-ancestors.
    await e.goto(`${EVIL}/frame`);
    const blocked = await e.evaluate(async (url) => { const f = document.getElementById('f'); f.src = url; await new Promise(r => setTimeout(r, 4000)); try { return f.contentDocument?.body?.innerText ?? 'cross-origin'; } catch { return 'cross-origin'; } }, `${APP}/help?token=${token}&embed=${encodeURIComponent(EVIL)}&fexp=9999999999&fsig=${'0'.repeat(64)}`);
    const helpFrame = e.frames().find(f => f.url().includes('/help'));
    const rendered = helpFrame ? await helpFrame.locator('h1').count().catch(() => 0) : 0;
    assert.equal(rendered, 0, `help must not render inside evil.example (${blocked})`); ok();
    // Turning the key off stops new loads everywhere.
    await db.query('begin'); await db.query("select set_config('app.widget_key_rpc','1',true)"); await db.query('update widget_settings set key_active=false where user_id=$1', [OWNER]); await db.query('commit');
    const fresh = await (await browser.newContext()).newPage();
    await fresh.route(`${SHOP}/**`, r => r.fulfill({contentType: 'text/html', body: page(SHOP)}));
    await fresh.goto(`${SHOP}/again`); await fresh.waitForTimeout(2500);
    assert.equal(await fresh.locator('#automatepal-billing-widget').count(), 0, 'turned-off key shows nothing'); ok();
    console.log(`PASS widget key end to end: ${n} checks; lazy conversation on first open, signed frame grant lets shop.example frame /help, exact answer through the widget, conversation reused across loads, reset starts a new one, other sites get no widget, no session and no framing, turned-off key shows nothing.`);
  } finally {
    await browser.close();
    await cleanup().catch(() => {});
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
