// Billing support UI (WebKit): visitor verification, billing record cards with source label, mode badge
// and hosted link, refund review request, capability-gated buttons, fictional card unchanged; and the
// owner /billing view (enabled providers only, LIVE confirmation phrase, secrets cleared after save).
// All /api calls are intercepted; nothing reaches a provider or the database. Run `npm run build` first.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {webkit} from '@playwright/test';
const PORT = 3261, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
let n = 0;
const ok = () => n++;
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/help'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
const caps = {order_status: true, payment_history: true, failed_payment: true, invoice: true, renewal: false, refund_status: true};
const fictional = {mode: 'fictional', reference: 'DEMO-11111111', title: 'Fictional Launch Kit order', totalMinor: 1900, currency: 'USD', paymentStatus: 'Not connected', refundStatus: 'Review only', invoiceStatus: 'Not issued', taxStatus: 'Not calculated'};
const caseItem = {order: 'Fictional Launch Kit order', amount: 19, currency: 'USD', status: 'Sandbox fixture', inboxState: 'open', branding: {label: 'Site help', initials: 'AP', prompts: [], color: '#233de8'}, controls: {}, billing: fictional,
  billingSupport: {providers: [{provider: 'paypal', label: 'PayPal', mode: 'test', capabilities: caps, referenceHint: 'Order ID, Invoice number'}], verified: null}};
const card = {provider: 'paypal', providerLabel: 'PayPal', mode: 'test', kind: 'invoice', id: 'INV2-AAAA-BBBB-CCCC-DDDD', displayRef: 'AP-1001', status: 'PARTIALLY_REFUNDED', amountMinor: 7500, currency: 'USD', createdAt: '2026-10-01T08:00:00.000Z', hostedUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2AAAABBBBCCCCDDDD', renewalAt: null, failure: null, refunds: [{id: '2RF11111AA111111A', status: 'RECORDED', amountMinor: 2500, currency: 'USD', createdAt: null}], parentRef: null};
const billingData = {providers: [{id: 'paypal', label: 'PayPal', tier: 'A', confidence: 'official-spec', enabled: true, credentialFields: [{name: 'clientId', label: 'Client ID', secret: false}, {name: 'clientSecret', label: 'Client secret', secret: true}], configFields: [], capabilities: {...caps, renewal: true}, modes: ['test', 'live'], referenceHint: ''}],
  connections: [], events: [], lookups: [{id: 'l1', case_id: 'de100001-0000-4000-8000-000000000001', provider: 'paypal', mode: 'test', kind: 'lookup', intent: 'refund_status', outcome: 'answered', record_kind: 'order', record_ref: '…901E', record_status: 'COMPLETED', amount_minor: 4900, currency: 'USD', created_at: '2026-10-30T10:00:00Z'}],
  available: true, role: 'owner', encryptionReady: true, paymentExecution: false, limits: {}};

try {
  await waitServer();
  const b = await webkit.launch();
  try {
    for (const vp of [{width: 390, height: 844}, {width: 1440, height: 900}]) {
      const p = await b.newPage({viewport: vp});
      const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const posts = [];
      let verified = false;
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        let body = {};
        if (u.includes('/api/support') && req.method() === 'GET') body = {case: {...caseItem, billingSupport: {...caseItem.billingSupport, verified: verified ? {provider: 'paypal', expiresAt: new Date(Date.now() + 1800000).toISOString()} : null}}};
        else if (u.includes('/api/support')) {
          const j = req.postDataJSON(); posts.push(j);
          if (j.action === 'billing_verify') { verified = true; body = {verified: true, provider: 'paypal', mode: 'test', expiresAt: new Date(Date.now() + 1800000).toISOString()}; }
          else if (j.action === 'answer') body = {answer: 'Your invoice AP-1001 is partially refunded (USD 75.00). No refund has been issued by this assistant. Read-only Test mode record. No money moved.', supported: true, answerKind: 'billing_record', interactionId: 'i1',
            sources: [{id: 'billing:paypal:invoice:INV2', title: 'PayPal invoice AP-1001', sourceKind: 'billing_record', quotes: ['Status: PARTIALLY_REFUNDED']}], billing: {cards: [card], lookupId: '11111111-1111-4111-8111-111111111111', mode: 'test', provider: 'paypal'}};
          else if (j.action === 'billing_refund') body = {id: 'r1', note: 'Sent to the owner for refund review with the payment attached. No refund has been issued and no money moved.'};
          else body = {note: 'ok'};
        }
        r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
      });
      await p.goto(BASE + '/help?token=' + 'a'.repeat(64));
      await p.getByText('Clear answers. A person when needed.').waitFor();
      // The fictional fixture card still renders next to real billing support.
      await p.getByRole('region', {name: 'Fictional billing overview'}).waitFor(); ok();
      const form = p.getByRole('form', {name: 'Check a payment'});
      await form.waitFor(); ok();
      await form.getByLabel('Order or invoice number').fill('AP-1001');
      await form.getByLabel('Email used to pay').fill('alex.payer@example.test');
      await form.getByRole('button', {name: 'Check payment'}).click();
      await p.getByText('Verified for this chat for 30 minutes', {exact: false}).waitFor(); ok();
      const v = posts.find((x) => x.action === 'billing_verify');
      assert.deepEqual([v.provider, v.reference, v.email], ['paypal', 'AP-1001', 'alex.payer@example.test']); ok();
      // Only capabilities the provider supports get a quick button.
      const group = p.getByRole('group', {name: 'Billing questions'}).or(p.locator('[aria-label="Billing questions"]'));
      assert.equal(await group.getByRole('button', {name: 'Subscription renewal'}).count(), 0, 'unsupported capability hidden'); ok();
      assert.equal(await group.getByRole('button', {name: 'Refund status'}).count(), 1); ok();
      await group.getByRole('button', {name: 'Refund status'}).click();
      const rec = p.getByRole('region', {name: 'Billing record'});
      await rec.waitFor(); ok();
      assert.equal(posts.find((x) => x.action === 'answer').question, 'What is the status of my refund?'); ok();
      assert.equal(await rec.getByText('Test mode', {exact: true}).count(), 1); ok();
      assert.equal(await rec.getByRole('link', {name: 'View hosted invoice'}).getAttribute('href'), card.hostedUrl); ok();
      assert.equal(await rec.getByRole('link', {name: 'View hosted invoice'}).getAttribute('rel'), 'noopener noreferrer'); ok();
      await rec.getByText('Read-only. No money moves from this chat.').waitFor(); ok();
      await p.getByText('Billing record: PayPal invoice AP-1001', {exact: false}).waitFor(); ok();
      assert.equal(await p.getByText('This question could not be answered from published sources.').count(), 0); ok();
      await p.getByRole('button', {name: 'Request refund review'}).click();
      await p.getByText('Sent to the owner for refund review with the payment attached.', {exact: false}).waitFor(); ok();
      const refund = posts.find((x) => x.action === 'billing_refund');
      assert.equal(refund.lookupId, '11111111-1111-4111-8111-111111111111'); assert.ok(refund.message.length >= 5); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `help overflow at ${vp.width}`); ok();
      await p.screenshot({path: `/tmp/ap-downloads/billing-help-${vp.width}.png`, fullPage: true}).catch(() => {});

      // Owner billing view.
      let saved = null;
      await p.unroute('**/api/**');
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/billing') && req.method() === 'POST') { saved = req.postDataJSON(); return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({note: 'PayPal connected in LIVE mode. Read-only lookups only; no money moves.'})}); }
        if (u.includes('/api/billing')) return r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(billingData)});
        return r.fulfill({status: 200, contentType: 'application/json', body: '{}'});
      });
      await p.goto(BASE + '/billing');
      await p.getByRole('heading', {name: 'Payment providers'}).waitFor();
      const providers = p.locator('.bl-provider');
      assert.equal(await providers.count(), 1, 'enabled providers only'); assert.match(await providers.first().innerText(), /PayPal/); ok();
      await p.getByText('Read-only. No money moves. Refunds are recorded for review, never executed.', {exact: false}).waitFor(); ok();
      assert.equal(await p.getByRole('link', {name: 'Open ticket'}).first().getAttribute('href'), '/tickets?ticket=de100001-0000-4000-8000-000000000001'); ok();
      await providers.first().getByRole('button', {name: 'Connect'}).click();
      await p.getByLabel('LIVE').check();
      await p.getByLabel('Client ID').fill('AYfictionalClientId00000000001');
      await p.getByLabel('Client secret').fill('EFfictionalClientSecret0000000001');
      assert.equal(await p.getByLabel('Client secret').getAttribute('type'), 'password'); ok();
      await p.getByRole('button', {name: 'Continue to LIVE confirmation'}).click();
      const connectLive = p.getByRole('button', {name: 'Connect LIVE'});
      assert.equal(await connectLive.isDisabled(), true, 'phrase required'); ok();
      await p.getByLabel('Live confirmation phrase').fill('connect live paypal');
      assert.equal(await connectLive.isDisabled(), true, 'phrase is exact'); ok();
      await p.getByLabel('Live confirmation phrase').fill('CONNECT LIVE PAYPAL');
      await connectLive.click();
      await p.getByText('PayPal connected in LIVE mode.', {exact: false}).waitFor();
      assert.deepEqual([saved.action, saved.provider, saved.mode, saved.confirmLive, saved.credentials.clientSecret], ['connect', 'paypal', 'live', 'CONNECT LIVE PAYPAL', 'EFfictionalClientSecret0000000001']); ok();
      assert.equal(await p.getByLabel('Client secret').inputValue(), '', 'secret cleared after save'); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `billing overflow at ${vp.width}`); ok();
      await p.screenshot({path: `/tmp/ap-downloads/billing-owner-${vp.width}.png`, fullPage: true}).catch(() => {});
      assert.deepEqual(errors, [], `page/console errors at ${vp.width}: ${errors.join(' | ')}`); ok();
      await p.close();
    }
  } finally { await b.close(); }
  console.log(`PASS verify-billing-support-ui: ${n} checks (WebKit 390 + 1440: verify form, verified state, capability-gated buttons, billing record card with source label, Test mode badge and hosted link, refund review posts billing_refund, fictional card unchanged; /billing enabled providers only, LIVE phrase gate, secret cleared, no overflow, no console errors)`);
} finally { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); }
