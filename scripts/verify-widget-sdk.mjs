// Widget SDK (public/widget.js): window.AutomatePal open/close/toggle/reset, queued calls before mount, events
// (open, close, message_sent, handoff_requested, lead_submitted) through on()/off() and automatepal:* DOM
// events, payloads rebuilt from the allow-list (no text, email or token), and messages accepted only from the
// panel frame at the app origin. Every request is intercepted; the /help panel is a stub that posts events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '@playwright/test';
const TOKEN = 'b'.repeat(64);
let n = 0;
const ok = () => n++;
// The stub panel posts the events a real /help would send, plus fields that must never reach the page.
const HELP = `<html><body><p>Fictional support</p><script>
const to=new URLSearchParams(location.search).get('embed');
const send=(m)=>parent.postMessage(m,to);
send({source:'automatepal-help',event:'message_sent',channel:'ai',text:'SECRET question text',email:'jane@example.com'});
send({source:'automatepal-help',event:'handoff_requested',withinHours:true,name:'Jane Doe'});
send({source:'automatepal-help',event:'lead_submitted',email:'jane@example.com',token:'${TOKEN}'});
send({source:'automatepal-help',event:'message_sent',channel:'<script>'});
send({source:'automatepal-help',event:'exec_code'});
send({source:'someone-else',event:'lead_submitted'});
</script></body></html>`;
async function page(browser, {path = '/shop', settings = {label: 'Site help', side: 'right', color: '#233de8', autoOpen: false, excludedPaths: []}, delay = 0} = {}) {
  const p = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.includes('/api/widget?')) { if (delay) await new Promise((res) => setTimeout(res, delay)); return r.fulfill({contentType: 'application/json', headers: {'Access-Control-Allow-Origin': 'https://merchant.example'}, body: JSON.stringify({settings})}); }
    if (u.includes('widget.js')) return r.fulfill({contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync('public/widget.js', 'utf8')});
    if (u.includes('/help?')) return r.fulfill({contentType: 'text/html; charset=utf-8', body: HELP});
    return r.fulfill({contentType: 'text/html; charset=utf-8', body: `<html><body><h1>Fictional merchant</h1><script src="https://automatepal.onrender.com/widget.js" data-demo-token="${TOKEN}" defer></script></body></html>`});
  });
  await p.goto('https://merchant.example' + path);
  await p.waitForFunction(() => !!window.AutomatePal);
  // Record events through both mechanisms.
  await p.evaluate(() => {
    window.__ev = []; window.__dom = [];
    for (const t of window.AutomatePal.events) { window.AutomatePal.on(t, (e) => window.__ev.push(e)); window.addEventListener('automatepal:' + t, (e) => window.__dom.push(e.detail)); }
  });
  return {p, errors};
}
const events = (p) => p.evaluate(() => window.__ev);
const shown = (p) => p.locator('iframe').evaluate((f) => f.style.display !== 'none');
const browser = await chromium.launch();
try {
  const {p, errors} = await page(browser);
  await p.locator('button').waitFor();
  assert.deepEqual(await p.evaluate(() => Object.keys(window.AutomatePal).sort()), ['close', 'events', 'off', 'on', 'open', 'reset', 'toggle']); ok();
  assert.deepEqual(await p.evaluate(() => [...window.AutomatePal.events]), ['open', 'close', 'message_sent', 'handoff_requested', 'lead_submitted']); ok();
  assert.equal(await p.evaluate(() => Object.isFrozen(window.AutomatePal)), true); ok();
  assert.equal(await p.locator('iframe').getAttribute('src'), null, 'still lazy'); ok();
  assert.deepEqual(await events(p), [], 'no event on a closed mount'); ok();
  // open(): panel visible, frame loads with the page origin, open event.
  await p.evaluate(() => window.AutomatePal.open());
  assert.equal(await shown(p), true); ok();
  assert.match(await p.locator('iframe').getAttribute('src'), /\/help\?token=b{64}&embed=https%3A%2F%2Fmerchant\.example&page=%2F[^&]*$/); ok();
  await p.waitForFunction(() => window.__ev.length >= 4);
  await p.waitForTimeout(300);
  // A message from the merchant page itself is ignored (wrong source window).
  await p.evaluate(() => window.postMessage({source: 'automatepal-help', event: 'lead_submitted'}, '*'));
  await p.waitForTimeout(200);
  const first = await events(p);
  assert.deepEqual(first, [{type: 'open', trigger: 'api'}, {type: 'message_sent', channel: 'ai'}, {type: 'handoff_requested', withinHours: true}, {type: 'lead_submitted'}, {type: 'message_sent'}], 'allow-listed fields only; unknown events and sources dropped'); ok();
  assert.deepEqual(await p.evaluate(() => window.__dom), first, 'DOM events carry the same payloads'); ok();
  const blob = JSON.stringify(first);
  for (const bad of ['SECRET', '@', 'Jane', TOKEN, '<script>']) { assert.ok(!blob.includes(bad), bad); ok(); }
  assert.equal(await p.evaluate(() => Object.isFrozen(window.__ev[1])), true, 'payloads are frozen'); ok();
  // close(), toggle(), the button and reset().
  await p.evaluate(() => { window.__ev.length = 0; window.AutomatePal.close(); window.AutomatePal.close(); });
  assert.equal(await shown(p), false); ok();
  await p.evaluate(() => { window.AutomatePal.toggle(); window.AutomatePal.toggle(); });
  await p.locator('button').click();
  assert.equal(await shown(p), true); ok();
  assert.deepEqual(await events(p), [{type: 'close', trigger: 'api'}, {type: 'open', trigger: 'api'}, {type: 'close', trigger: 'api'}, {type: 'open', trigger: 'button'}], 'no duplicate close; toggle and button'); ok();
  assert.equal(await p.locator('button').innerText(), 'Close Site help'); ok();
  await p.evaluate(() => { window.__ev.length = 0; window.AutomatePal.reset(); });
  assert.equal(await shown(p), false); ok();
  assert.equal(await p.locator('iframe').getAttribute('src'), 'about:blank', 'panel cleared'); ok();
  assert.equal(await p.evaluate(() => sessionStorage.getItem('automatepal-demo-' + 'b'.repeat(64))), null, 'open state forgotten'); ok();
  assert.deepEqual(await events(p), [{type: 'close', trigger: 'reset'}]); ok();
  await p.evaluate(() => window.AutomatePal.open());
  assert.match(await p.locator('iframe').getAttribute('src'), /\/help\?token=/, 'fresh panel on the next open'); ok();
  await p.waitForFunction(() => window.__ev.filter((e) => e.type === 'lead_submitted').length === 1);
  // off() and the unsubscribe function; unknown event names are ignored.
  const counts = await p.evaluate(async () => {
    const seen = []; const fn = (e) => seen.push(e.type);
    const stop = window.AutomatePal.on('close', fn); window.AutomatePal.close(); stop(); window.AutomatePal.open(); window.AutomatePal.close();
    window.AutomatePal.on('open', fn); window.AutomatePal.off('open', fn); window.AutomatePal.open();
    const noop = window.AutomatePal.on('exec', fn); window.AutomatePal.on('close', 'not a function');
    return {seen, noop: typeof noop};
  });
  assert.deepEqual(counts, {seen: ['close'], noop: 'function'}); ok();
  // A throwing listener does not break the widget or other listeners.
  await p.evaluate(() => { window.AutomatePal.on('close', () => { throw Error('merchant bug'); }); window.__ev.length = 0; window.AutomatePal.close(); });
  assert.deepEqual(await events(p), [{type: 'close', trigger: 'api'}]); ok();
  assert.deepEqual(errors, []); ok();
  await p.close();

  // Calls made before the widget mounts are applied once it is ready.
  const slow = await page(browser, {delay: 800});
  assert.equal(await slow.p.locator('#automatepal-billing-widget').count(), 0, 'not mounted yet'); ok();
  await slow.p.evaluate(() => window.AutomatePal.open());
  await slow.p.waitForFunction(() => window.__ev.length >= 1);
  assert.deepEqual((await events(slow.p))[0], {type: 'open', trigger: 'api'}); ok();
  assert.equal(await shown(slow.p), true); ok();
  await slow.p.close();

  // Auto-open reports trigger auto; an excluded page mounts nothing and the API stays a safe no-op.
  const auto = await page(browser, {settings: {label: 'Demo help', autoOpen: true, excludedPaths: []}, delay: 300});
  await auto.p.waitForFunction(() => window.__ev.length >= 1);
  assert.deepEqual((await events(auto.p))[0], {type: 'open', trigger: 'auto'}); ok();
  await auto.p.close();
  // Proactive message: shown after the delay beside the closed button, as text only; clicking it opens the chat
  // with trigger proactive; it is not shown again in the same browser session; dismissing removes it.
  const note = () => document.getElementById('automatepal-billing-widget')?.shadowRoot?.getElementById('automatepal-note');
  const pro = await page(browser, {path: '/pricing/annual', settings: {label: 'Demo help', excludedPaths: [], proactive: [{path: '/', message: 'General <b>help</b>', delaySeconds: 0}, {path: '/pricing', message: 'Questions about plans? <img src=x onerror=alert(1)>', delaySeconds: 1}]}});
  await pro.p.waitForLoadState('networkidle');
  assert.equal(await pro.p.evaluate(`!!(${note})()`), false, 'not before the delay');
  await pro.p.waitForFunction(`!!(${note})()`, null, {timeout: 5000});
  assert.deepEqual(await pro.p.evaluate(`(() => { const n = (${note})(); return [n.querySelector('button').textContent, n.querySelectorAll('img,b,script').length, n.querySelectorAll('button')[1].getAttribute('aria-label')]; })()`), ['Questions about plans? <img src=x onerror=alert(1)>', 0, 'Close']); ok();
  await pro.p.evaluate(`(${note})().querySelector('button').click()`);
  assert.deepEqual((await events(pro.p))[0], {type: 'open', trigger: 'proactive'}); assert.equal(await pro.p.evaluate(`!!(${note})()`), false, 'note gone once the chat opens'); ok();
  await pro.p.evaluate(() => window.AutomatePal.close()); await pro.p.reload(); await pro.p.waitForLoadState('networkidle'); await pro.p.waitForTimeout(1800);
  assert.equal(await pro.p.evaluate(`!!(${note})()`), false, 'once per browser session'); ok();
  assert.deepEqual(pro.errors, []);
  await pro.p.close();
  const dismiss = await page(browser, {settings: {label: 'Demo help', excludedPaths: [], proactive: [{path: '/', message: 'Need a hand?', delaySeconds: 0}]}});
  await dismiss.p.waitForFunction(`!!(${note})()`, null, {timeout: 5000});
  await dismiss.p.evaluate(`(${note})().querySelectorAll('button')[1].click()`);
  assert.equal(await dismiss.p.evaluate(`!!(${note})()`), false); assert.deepEqual(await events(dismiss.p), [], 'dismissing opens nothing'); ok();
  await dismiss.p.close();
  const excluded = await page(browser, {path: '/account/settings', settings: {excludedPaths: ['/account']}});
  await excluded.p.waitForLoadState('networkidle');
  await excluded.p.evaluate(() => { window.AutomatePal.open(); window.AutomatePal.reset(); });
  assert.equal(await excluded.p.locator('#automatepal-billing-widget').count(), 0); assert.deepEqual(await events(excluded.p), []); ok();
  assert.deepEqual(excluded.errors, []); ok();
  await excluded.p.close();
  console.log(`PASS widget SDK: ${n} checks; open/close/toggle/reset, queued calls before mount, auto-open trigger, proactive message (delay, longest path, text only, opens with trigger proactive, once per session, dismiss), excluded page no-op, events via on()/off() and automatepal:* DOM events, payloads limited to type + fixed label (no text, email, name, token), messages only from the panel frame, throwing listeners isolated.`);
} finally { await browser.close(); }
