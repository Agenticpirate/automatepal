// End to end: a permanent widget key on a merchant site (another origin), against a LOCAL app server wired to
// the LOCAL Supabase. Usage (app started with the local Supabase URL, anon key and service-role key in env):
//   E2E_APP=http://localhost:3100 LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//   node scripts/verify-widget-key-e2e.mjs
// Seeds one key, allowed origin and published exact answer for the first synthetic user, and removes them after.
import assert from 'node:assert/strict';
import pg from 'pg';
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
// Serious or critical WCAG 2.1 A/AA violations (axe-core) in a page or frame, as short strings.
async function axeSerious(target) {
  await target.addScriptTag({content: AXE});
  const r = await target.evaluate(() => window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']}));
  return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(', ')}`);
}
const APP = process.env.E2E_APP, DB = process.env.LOCAL_DATABASE_URL;
if (!APP || !DB) { console.error('Set E2E_APP and LOCAL_DATABASE_URL.'); process.exit(1); }
for (const u of [APP, DB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
const OWNER = '00000000-0000-4000-8000-000000000001', KEY = 'pk_test_E2eWidgetKey000000000000', SHOP = 'https://shop.example', EVIL = 'https://evil.example';
const Q = 'What are your support hours?', A = 'Our team answers Monday to Friday, 9am to 5pm IST.';
const db = new pg.Client({connectionString: DB});
let n = 0;
const ok = () => { n++; };
const cases = async () => Number((await db.query("select count(*) from support_cases where user_id=$1 and source='widget'", [OWNER])).rows[0].count);
const page = (origin) => `<!doctype html><html lang="en"><head><title>Shop</title></head><body><h1>${origin}</h1><script src="${APP}/widget.js" data-bot="${KEY}" async></script></body></html>`;
async function seed() {
  await db.query('begin');
  await db.query("select set_config('app.widget_key_rpc','1',true)");
  await db.query(`insert into widget_settings(user_id,bot_id,label,public_key,key_active,controls) values($1,$1,'Shop help',$2,true,$3)
    on conflict(bot_id) do update set label='Shop help',public_key=$2,key_active=true,controls=$3`, [OWNER, KEY, JSON.stringify({allowedOrigins: [SHOP]})]);
  await db.query('insert into custom_responses(user_id,question,answer,published) values($1,$2,$3,true) on conflict do nothing', [OWNER, Q, A]);
  await db.query('commit');
}
async function cleanup() {
  await db.query("delete from support_cases where user_id=$1 and source='widget'", [OWNER]);
  await db.query("delete from bots where workspace_id=$1 and id<>$1", [OWNER]).catch(() => {});
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
    // Accessibility of what shoppers see: the launcher (in its shadow root) and the chat panel.
    assert.deepEqual(await axeSerious(await (await frameEl.elementHandle()).contentFrame()), [], 'chat panel accessibility');
    assert.deepEqual(await axeSerious(p.mainFrame()), [], 'launcher accessibility'); ok();
    const helpCsp = (await (await fetch(src)).headers.get('content-security-policy')) ?? '';
    assert.match(helpCsp, /frame-ancestors 'self' https:\/\/shop\.example/); ok();
    const ans = await (await fetch(`${APP}/api/support`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'answer', token, question: Q, source: 'widget'})})).json();
    assert.equal(ans.answer, A, 'exact owner answer through the widget conversation'); ok();
    // CSAT: no rating prompt before an answer; after asking in the panel the visitor rates 1 to 5 and can change it.
    assert.equal(await frame.getByRole('group', {name: 'How was this conversation?'}).count(), 0, 'no rating prompt before an answer');
    await frame.locator('#help-message').fill(Q); await frame.getByRole('button', {name: 'Ask a question', exact: true}).last().click();
    const rating = frame.getByRole('group', {name: 'How was this conversation?'}); await rating.waitFor({timeout: 30000});
    await rating.getByRole('button', {name: '4 / 5'}).click(); await frame.getByText('Thanks for your rating.').waitFor();
    await rating.getByRole('button', {name: '5 / 5'}).click(); await frame.locator('button[aria-pressed="true"][aria-label="5 / 5"]').waitFor();
    assert.deepEqual((await db.query('select r.score from case_ratings r join support_cases c on c.id=r.case_id where c.user_id=$1', [OWNER])).rows, [{score: 5}], 'one rating, replaced'); ok();
    assert.deepEqual(await axeSerious(await (await frameEl.elementHandle()).contentFrame()), [], 'rating prompt accessibility'); ok();
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
    // A second bot (db/062): its own key, name and look on the same site.
    {
      const KEY2 = 'pk_test_E2eSecondBot0000000000000'.slice(0, 32);
      const bot2 = (await db.query("insert into bots(workspace_id,name) values($1,'Docs bot') returning id", [OWNER])).rows[0].id;
      await db.query('begin'); await db.query("select set_config('app.widget_key_rpc','1',true)");
      await db.query("insert into widget_settings(user_id,bot_id,label,color,public_key,key_active,controls) values($1,$2,'Docs help','#0f766e',$3,true,$4)", [OWNER, bot2, KEY2, JSON.stringify({allowedOrigins: [SHOP]})]);
      await db.query('commit');
      const c2 = await browser.newContext(); const t = await c2.newPage();
      await t.route(`${SHOP}/**`, r => r.fulfill({contentType: 'text/html', body: `<!doctype html><body><script src="${APP}/widget.js" data-bot="${KEY2}" async></script></body>`}));
      await t.goto(`${SHOP}/docs`);
      const b2 = t.locator('#automatepal-billing-widget button'); await b2.waitFor({timeout: 20000});
      assert.equal((await b2.innerText()).trim(), 'Docs help', 'second bot has its own name'); ok();
      await b2.click();
      await t.frameLocator('#automatepal-billing-widget iframe').locator('header').getByText('Docs help').waitFor({timeout: 30000}); ok();
      const tok = new URL(await t.locator('#automatepal-billing-widget iframe').getAttribute('src')).searchParams.get('token');
      const caseBot = (await db.query("select bot_id from support_cases where token_hash=encode(sha256($1::bytea),'hex')", [tok])).rows[0]?.bot_id;
      assert.equal(caseBot, bot2, 'conversation belongs to the second bot'); ok();
      await c2.close();
      await db.query('delete from bots where id=$1', [bot2]);
    }
    // Logo, per-page starters and the chat language, on a fresh visitor at /pricing.
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await db.query('begin'); await db.query("select set_config('app.widget_key_rpc','1',true)");
    await db.query(`update widget_settings set key_active=true,logo_type='image/png',logo_data=$2,logo_version=logo_version+1,
      controls=controls||'{"language":"es","pageStarters":[{"path":"/pricing","prompts":["Which plan fits me?"]}],"proactive":[{"path":"/pricing","message":"Questions about our plans? Ask here.","delaySeconds":0}]}' where user_id=$1`, [OWNER, PNG1]);
    await db.query('commit');
    {
      const c3 = await browser.newContext({locale: 'en-US'}); const t = await c3.newPage();
      await t.route(`${SHOP}/**`, r => r.fulfill({contentType: 'text/html', body: page(SHOP)}));
      await t.goto(`${SHOP}/pricing`);
      const b = t.locator('#automatepal-billing-widget button[aria-controls="automatepal-panel"]'); await b.waitFor({timeout: 20000});
      await t.waitForFunction(() => { const i = document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('button img'); return i && i.complete && i.naturalWidth === 1; }, null, {timeout: 20000});
      ok(); // logo image loaded on the button from /api/widget/logo
      // Proactive message for /pricing beside the closed button; accessible; gone once the chat opens.
      const noteText = () => document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('#automatepal-note button')?.textContent ?? null;
      await t.waitForFunction(noteText, null, {timeout: 10000}); assert.equal(await t.evaluate(noteText), 'Questions about our plans? Ask here.');
      assert.deepEqual(await axeSerious(t.mainFrame()), [], 'proactive message accessibility');
      if (process.env.E2E_SHOT) await t.screenshot({path: process.env.E2E_SHOT});
      await b.click();
      assert.equal((await b.innerText()).trim(), 'Cerrar Shop help', 'button text in the chosen language'); ok();
      assert.equal(await t.evaluate(noteText), null, 'note removed when the chat opens'); ok();
      const f = t.frameLocator('#automatepal-billing-widget iframe');
      await f.getByRole('button', {name: 'Preguntar a la IA'}).waitFor({timeout: 30000}); ok();
      await f.getByRole('button', {name: 'Which plan fits me?'}).waitFor(); ok(); // /pricing starter
      assert.equal(await f.locator('header img').count(), 1, 'logo in the chat header'); ok();
      await c3.close();
    }
    // Tag-manager style installs on an allowed origin: script injected by JavaScript with the key in the URL,
    // and the AutomatePalConfig variant with no data- attributes at all.
    await db.query('begin'); await db.query("select set_config('app.widget_key_rpc','1',true)"); await db.query('update widget_settings set key_active=true where user_id=$1', [OWNER]); await db.query('commit');
    for (const [name, html] of [
      ['injected ?bot=', `<!doctype html><body><script>var s=document.createElement('script');s.async=true;s.src='${APP}/widget.js?bot=${KEY}';document.body.appendChild(s);</script></body>`],
      ['AutomatePalConfig', `<!doctype html><body><script>window.AutomatePalConfig={bot:'${KEY}'};</script><script src="${APP}/widget.js" async></script></body>`],
    ]) {
      const c2 = await browser.newContext(); const t = await c2.newPage();
      await t.route(`${SHOP}/**`, r => r.fulfill({contentType: 'text/html', body: html}));
      await t.goto(`${SHOP}/gtm`);
      await t.locator('#automatepal-billing-widget button').waitFor({timeout: 20000});
      await t.locator('#automatepal-billing-widget button').click();
      await t.waitForFunction(() => document.getElementById('automatepal-billing-widget')?.shadowRoot?.querySelector('iframe')?.src.includes('fsig='), null, {timeout: 20000});
      ok(); await c2.close();
      assert.ok(name);
    }
    console.log(`PASS widget key end to end: ${n} checks; lazy conversation on first open, launcher and chat panel without serious WCAG 2.1 AA issues, signed frame grant lets shop.example frame /help, exact answer through the widget, 1 to 5 conversation rating from the panel (replaceable), conversation reused across loads, reset starts a new one, other sites get no widget, no session and no framing, turned-off key shows nothing, tag-manager installs (?bot= injected, AutomatePalConfig) work, logo on button and header, per-page starters, proactive message, Spanish chat, a second bot with its own key, name and conversations.`);
  } finally {
    await browser.close();
    await cleanup().catch(() => {});
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
