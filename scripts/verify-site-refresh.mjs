// Website and demo refresh (Phase 4), WebKit. Run `npm run build` first.
// - /, /pricing and /docs at 1440x1000, 820x1180 and 390x844, once with reduced motion and once without:
//   no console errors or page errors, no horizontal overflow.
// - The provider names the site shows come from lib/billing/core/registry.ts: the client mirror
//   (app/components/home/billing-providers.ts) must equal the registry's enabled entries and capability
//   matrices, every enabled provider is named, and no provider without an enabled adapter is named on /.
// - /: demo scenarios 0 (seats) and 1 (refund) keep their exact replies; a billing scenario shows customer
//   verification and the provider card; the owner reply, away message and MCP scenarios render; the new
//   feature cards, trust items, FAQ entries, owner-view inbox and Docs link exist.
// - /docs: every section heading exists. /help at 390 with an intercepted /api/support: verify form and card.
// Screenshots go to /tmp/ap-downloads/site-refresh-*.png. No request leaves the machine.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {webkit} from '@playwright/test';

const PORT = 3264, BASE = `http://127.0.0.1:${PORT}`, OUT = '/tmp/ap-downloads';
mkdirSync(OUT, {recursive: true});
let checks = 0;
const ok = (name) => { checks++; if (process.env.VERBOSE) console.log('PASS', name); };

// Registry truth, read through tsx (the registry is TypeScript with extensionless imports).
const truth = JSON.parse(execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '-e', `(async () => {
  const reg = await import('./lib/billing/core/registry.ts');
  const types = await import('./lib/billing/core/types.ts');
  const site = await import('./app/components/home/billing-providers.ts');
  const enabled = reg.providerSummaries().map((p) => ({id: p.id, label: p.label, confidence: p.confidence, missing: Object.entries(p.capabilities).filter(([, v]) => !v).map(([k]) => k)}));
  const known = types.BILLING_PROVIDER_IDS.map((id) => ({id, label: reg.providerDefinition(id)?.label ?? null, enabled: !!reg.enabledDefinition(id)}));
  console.log(JSON.stringify({enabled, known, site: site.SITE_BILLING_PROVIDERS, exceptions: site.capabilityExceptions()}));
})()`], {encoding: 'utf8'}).trim().split('\n').pop());
assert.deepEqual(truth.site, truth.enabled, 'billing-providers.ts must mirror the registry enabled list and capability matrices'); ok('site provider mirror equals registry');
const ENABLED = truth.enabled.map((p) => p.label);
const NAMES = {polar: 'Polar', braintree: 'Braintree', cashfree: 'Cashfree'};
// Providers without an enabled adapter, plus well-known providers nobody has built.
const FORBIDDEN = [...truth.known.filter((k) => !k.enabled).map((k) => k.label ?? NAMES[k.id] ?? k.id), 'Authorize.net', 'Checkout.com', 'Klarna', 'Worldpay', 'Recurly', 'FastSpring', 'Gumroad', '2Checkout'];
assert.ok(FORBIDDEN.includes('Polar') && FORBIDDEN.includes('Braintree') && FORBIDDEN.includes('Cashfree')); ok('not-built providers listed');

const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/docs'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 400)); } throw Error('no server'); }
const VIEWPORTS = [['1440', 1440, 1000], ['820', 820, 1180], ['390', 390, 844]];
const DOC_HEADINGS = ['Install the widget', 'Connect billing', 'Customer verification', 'Refund reviews', 'Owner replies', 'Working hours', 'MCP server', 'Limits and what is not built'];
const CARDS = ['Billing answers from your payment provider', 'Reply inside the widget', 'Working hours and away message', 'Connect AI assistants over MCP'];
const TRUST = ['Encrypted, rotatable provider keys', 'Read-only by design: write calls are blocked in code', 'No money movement'];
const FAQ = ['Which payment providers does it work with?', 'Can it issue refunds?', 'How are customers verified before billing answers?', 'Are owner replies emailed?', 'What does the MCP server expose?'];
const SEATS = 'The fictional North Dock student plan includes 25 seats.';
const REFUND = 'This needs an owner review. No refund has been issued.';

function watch(p) {
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  p.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data')) errors.push('external request: ' + r.url()); });
  return errors;
}
// Scroll through the page so reveal-on-scroll sections settle before measuring and screenshots.
async function settle(p) {
  await p.evaluate(async () => { const step = Math.max(300, innerHeight * .8); for (let y = 0; y < document.body.scrollHeight; y += step) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); });
  await p.waitForTimeout(300);
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function ask(p, option) {
  await p.getByLabel('Choose a fictional question').selectOption(option);
  await p.getByRole('button', {name: 'Try this question'}).click();
}

async function homeChecks(p, tag) {
  const log = p.getByRole('log', {name: 'Demo conversation'});
  await ask(p, '0'); await log.getByText(SEATS, {exact: true}).waitFor(); ok(tag + ' scenario 0 seats');
  await ask(p, '1'); await log.getByText(REFUND, {exact: true}).waitFor(); ok(tag + ' scenario 1 refund');
  await ask(p, {label: 'Where is my order, and was I charged?'});
  await log.getByText('Verified for this chat', {exact: false}).first().waitFor();
  await log.getByText('Found it. Your Launch Kit payment went through 12 days ago and there are no refunds on it.', {exact: true}).waitFor();
  assert.ok(await log.getByText('PayPal · Test mode', {exact: true}).count() >= 1, 'provider card label'); ok(tag + ' billing verification + provider card');
  // Verified once per chat: the next billing question does not ask again.
  const asks = await log.getByText('First, what’s your order or invoice number', {exact: false}).count();
  await ask(p, {label: 'Why did my last payment fail?'});
  await log.getByText('An automatic retry went through yesterday', {exact: false}).waitFor();
  assert.equal(await log.getByText('First, what’s your order or invoice number', {exact: false}).count(), asks, 'verification asked once'); ok(tag + ' verification reused');
  await ask(p, {label: 'Can I talk to a person at 11pm?'}); await log.getByText('Your request is saved for the team.', {exact: false}).waitFor(); ok(tag + ' away message');
  await ask(p, {label: 'Which tickets need me today?'}); await log.getByText('list_tickets found 4 open tickets', {exact: false}).waitFor(); ok(tag + ' MCP list_tickets');
  await ask(p, {label: 'Add our gift wrapping note as a source'}); await log.getByText('Saved as an unpublished proposal. The owner must approve and publish it in Knowledge.', {exact: true}).waitFor(); ok(tag + ' MCP proposal');
  await p.getByRole('region', {name: 'Owner review queue'}).getByRole('button', {name: 'Approve proposal'}).click();
  await p.getByText('Approved · stays unpublished until you publish it').waitFor(); ok(tag + ' proposal approval stays unpublished');
  await ask(p, {label: 'Talk to a person'});
  await log.getByText('Hi, Sam from North Dock here.', {exact: false}).waitFor();
  assert.ok(await log.getByText('Shown in this widget only. Nothing is emailed.', {exact: true}).count() >= 1);
  await p.getByText('AI answers paused while the owner has this chat').waitFor(); ok(tag + ' owner reply in widget, AI paused');
  await p.locator('.hm-paused').getByRole('button', {name: 'Hand back'}).click();
  await log.getByText('Owner handed back · AI answers resume').waitFor(); ok(tag + ' hand back');
  for (const h of CARDS) assert.equal(await p.getByRole('heading', {name: h, exact: true}).count(), 1, 'card ' + h);
  for (const h of TRUST) assert.equal(await p.getByRole('heading', {name: h, exact: true}).count(), 1, 'trust ' + h);
  for (const q of FAQ) assert.equal(await p.locator('summary', {hasText: q}).count(), 1, 'faq ' + q);
  ok(tag + ' cards, trust, FAQ');
  // Lookup claims follow the capability matrix: the billing card and the Billing lookups add-on name
  // every enabled provider that lacks a capability, using the sentence generated from the mirror.
  const partial = truth.enabled.filter((x) => x.missing.length);
  assert.equal(truth.exceptions === '', partial.length === 0, 'exceptions sentence exists exactly when a provider lacks a capability');
  for (const x of partial) assert.ok(truth.exceptions.includes(x.label), 'exceptions name ' + x.label);
  const billCard = p.locator('article.hm-card', {has: p.getByRole('heading', {name: CARDS[0], exact: true})}).locator('.hm-card-copy > p');
  const billAddon = p.locator('li.hm-addon', {has: p.getByRole('heading', {name: 'Billing lookups', exact: true})}).locator('p');
  for (const [where, loc] of [['billing card', billCard], ['Billing lookups add-on', billAddon]]) {
    const t = await loc.innerText();
    assert.ok(t.includes('where the provider supports the lookup'), where + ' is qualified');
    assert.ok(t.includes(truth.exceptions), where + ' names the capability exceptions: ' + truth.exceptions);
  }
  ok(tag + ' billing claims match the capability matrix');
  // Owner view shows the redesigned inbox first, with the overview one tab away.
  const tabs = p.getByRole('tablist', {name: 'Owner screens'});
  assert.equal(await tabs.getByRole('tab', {name: 'Conversation inbox'}).getAttribute('aria-selected'), 'true');
  const inbox = p.locator('#ov-panel-inbox');
  await inbox.scrollIntoViewIfNeeded();
  const shot = inbox.locator('img:visible');
  await shot.first().waitFor();
  await p.waitForFunction(() => [...document.querySelectorAll('#ov-panel-inbox img')].some((i) => i.offsetParent && i.complete && i.naturalWidth > 0));
  assert.match(await shot.first().getAttribute('alt'), /conversation inbox/i); ok(tag + ' owner view shows the inbox');
  await tabs.getByRole('tab', {name: 'Owner overview'}).click();
  await p.locator('#ov-panel-overview').waitFor(); assert.equal(await inbox.isHidden(), true);
  await tabs.getByRole('tab', {name: 'Owner overview'}).press('ArrowLeft');
  assert.equal(await tabs.getByRole('tab', {name: 'Conversation inbox'}).getAttribute('aria-selected'), 'true'); ok(tag + ' owner view tabs');
  assert.equal(await p.locator('footer').getByRole('link', {name: 'Docs', exact: true}).getAttribute('href'), '/docs'); ok(tag + ' footer Docs link');
}

async function providerNames(p, path) {
  const text = await p.locator('body').innerText();
  for (const label of ENABLED) assert.ok(text.includes(label), path + ' names ' + label);
  if (path === '/') for (const name of FORBIDDEN) assert.ok(!new RegExp('\\b' + name.replace(/[.]/g, '\\.') + '\\b').test(text), '/ names a provider that is not enabled: ' + name);
  ok(path + ' provider names');
}

async function helpChecks(b, reduce) {
  const p = await b.newPage({viewport: {width: 390, height: 844}, reducedMotion: reduce});
  const errors = watch(p);
  const caps = {order_status: true, payment_history: true, failed_payment: true, invoice: true, renewal: true, refund_status: true};
  const card = {provider: 'paypal', providerLabel: 'PayPal', mode: 'test', kind: 'invoice', id: 'INV2-AAAA-BBBB-CCCC-DDDD', displayRef: 'ND-48213', status: 'PAID', amountMinor: 4900, currency: 'USD', createdAt: '2026-10-20T08:00:00.000Z', hostedUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2AAAABBBBCCCCDDDD', renewalAt: null, failure: null, refunds: [], parentRef: null};
  let verified = false;
  await p.route('**/api/**', (r) => {
    const req = r.request(), u = req.url();
    let body = {};
    if (u.includes('/api/support') && req.method() === 'GET') body = {case: {order: 'Fictional Launch Kit order', amount: 49, currency: 'USD', status: 'Sandbox fixture', inboxState: 'open', branding: {label: 'North Dock', initials: 'N', prompts: [], color: '#041A52'}, controls: {}, billingSupport: {providers: [{provider: 'paypal', label: 'PayPal', mode: 'test', capabilities: caps, referenceHint: 'Invoice number'}], verified: verified ? {provider: 'paypal', expiresAt: new Date(Date.now() + 1800000).toISOString()} : null}}};
    else if (u.includes('/api/support')) {
      const j = req.postDataJSON();
      if (j.action === 'billing_verify') { verified = true; body = {verified: true, provider: 'paypal', mode: 'test', expiresAt: new Date(Date.now() + 1800000).toISOString()}; }
      else if (j.action === 'answer') body = {answer: 'Invoice ND-48213 is paid (USD 49.00). Read-only Test mode record. No money moved.', supported: true, answerKind: 'billing_record', interactionId: 'i1', sources: [{id: 'billing:paypal:invoice:INV2', title: 'PayPal invoice ND-48213', sourceKind: 'billing_record', quotes: ['Status: PAID']}], billing: {cards: [card], lookupId: '11111111-1111-4111-8111-111111111111', mode: 'test', provider: 'paypal'}};
      else if (j.action === 'messages') body = {inboxState: 'open', messages: []};
      else body = {note: 'ok'};
    }
    r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  });
  await p.goto(BASE + '/help?token=' + 'b'.repeat(64));
  const form = p.getByRole('form', {name: 'Check a payment'});
  await form.waitFor();
  await form.getByLabel('Order or invoice number').fill('ND-48213');
  await form.getByLabel('Email used to pay').fill('buyer@example.test');
  await form.getByRole('button', {name: 'Check payment'}).click();
  await p.getByText('Verified for this chat for 30 minutes', {exact: false}).waitFor(); ok('help verify form ' + reduce);
  await p.locator('[aria-label="Billing questions"]').getByRole('button', {name: 'Invoice'}).first().click();
  const rec = p.getByRole('region', {name: 'Billing record'});
  await rec.waitFor();
  assert.equal(await rec.getByText('Test mode', {exact: true}).count(), 1); ok('help billing card ' + reduce);
  assert.equal(await noOverflow(p), true, '/help 390 overflow');
  await p.screenshot({path: `${OUT}/site-refresh-help-390-${reduce}.png`, fullPage: true});
  assert.deepEqual(errors, [], '/help errors'); ok('help no errors/overflow ' + reduce);
  await p.close();
}

try {
  await waitServer();
  const b = await webkit.launch();
  try {
    for (const reduce of ['reduce', 'no-preference']) {
      for (const path of ['/', '/pricing', '/docs']) {
        for (const [vw, width, height] of VIEWPORTS) {
          const p = await b.newPage({viewport: {width, height}, reducedMotion: reduce, colorScheme: 'light'});
          const errors = watch(p);
          const res = await p.goto(BASE + path, {waitUntil: 'load'});
          assert.equal(res.status(), 200, path);
          await settle(p);
          assert.equal(await noOverflow(p), true, `${path} ${vw} ${reduce} horizontal overflow`);
          // The custom domain is not live yet: no page may present automatepal.com as the site (the contact
          // email address on that domain is fine).
          const html = await p.content();
          assert.ok(!/(?<![@\w.-])(https?:\/\/)?(www\.)?automatepal\.com\b/.test(html), `${path} presents automatepal.com as the site`);
          if (path === '/' && vw === '1440') { await homeChecks(p, reduce); await providerNames(p, '/'); assert.equal(await noOverflow(p), true, '/ overflow after demo'); }
          if (path === '/' && vw === '390') {
            const narrow = p.locator('#ov-panel-inbox img.hm-ov-narrow');
            await narrow.scrollIntoViewIfNeeded(); await narrow.waitFor();
            assert.equal(await p.locator('#ov-panel-inbox img.hm-ov-wide').isVisible(), false); ok('phone inbox shot ' + reduce);
          }
          if (path === '/docs') {
            for (const h of DOC_HEADINGS) assert.equal(await p.getByRole('heading', {level: 2, name: h}).count(), 1, 'docs heading ' + h);
            if (vw === '1440') await providerNames(p, '/docs');
            ok(`/docs headings ${vw} ${reduce}`);
          }
          if (path === '/pricing') { await p.getByRole('heading', {name: 'Included in every preview configuration'}).waitFor(); assert.equal(await p.getByRole('status').count(), 1, 'pricing keeps one status region'); ok(`/pricing included ${vw} ${reduce}`); }
          await p.screenshot({path: `${OUT}/site-refresh${path === '/' ? '-home' : path.replace('/', '-')}-${vw}-${reduce}.png`, fullPage: true});
          assert.deepEqual(errors, [], `${path} ${vw} ${reduce} errors`);
          ok(`${path} ${vw} ${reduce} no errors, no overflow`);
          await p.close();
        }
      }
      await helpChecks(b, reduce);
    }
  } finally { await b.close(); }
  console.log(`PASS site refresh (WebKit): ${checks} checks. /, /pricing, /docs at 1440/820/390 with and without reduced motion: no console or page errors, no horizontal overflow. Demo scenarios 0/1 exact, billing verification, owner reply, away message, MCP. ${ENABLED.length} enabled providers named, none other on /. /help verify form and card at 390.`);
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
}
