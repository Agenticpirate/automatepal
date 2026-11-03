// APP_MODE=production wording gate (Chromium). Needs a build made with APP_MODE=production, because the mode is
// copied into the client bundle at build time:
//   APP_MODE=production npm run build && node scripts/verify-production-mode.mjs
// (then rebuild normally for the other gates). Every /api call from the browser is intercepted, so nothing
// reaches a database. For each page, after it hydrates, the visible text plus placeholder, aria-label, title
// and alt attributes, the document title and the description/OG/Twitter meta are searched for "fictional",
// "demo fixture" and "enter real". Only elements marked data-demo are exempt: the labelled marketing demo
// (scripted chat, answer pipeline, product screenshots), the open-demo banner and the widget's sample order
// card, which really are fictional fixtures. Also checks /status and /api/status report production, the
// client-rendered /help widget before and after an unanswered question, and that the demo labels remain.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
const PORT = 3287, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, APP_MODE: 'production', NEXT_PUBLIC_DEMO_OPEN: 'false'}});
let n = 0; const ok = () => n++;
const BAD = /fictional|demo fixture|enter real/i;
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/api/status'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
const json = (r, body, status = 200) => r.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
const TOKEN = 'a'.repeat(64);
const CASE = {order: 'Launch Kit order', amount: 19, currency: 'USD', status: 'open', inboxState: 'open', expiresAt: iso(-3600e3),
  billing: {mode: 'fictional', reference: 'DEMO-ABCDEF12', title: 'Launch Kit order', totalMinor: 1900, currency: 'USD', paymentStatus: 'Not connected', refundStatus: 'Review only', invoiceStatus: 'Not issued', taxStatus: 'Not calculated'},
  branding: {label: 'North Dock help', color: '#09318D', initials: 'ND', prompts: ['Where is my order?']}, controls: {}};
const MOCKS = {
  '/api/owner-overview': {asOf: new Date(now).toISOString(), tickets: [], queries: [], requests: [], usage: {utcDay: new Date(now).toISOString().slice(0, 10), answersToday: 0, dailyLimit: 100, sources: 0, sourceLimit: 30, pageUnits: 0, pageLimit: 360}, truncated: {tickets: false, queries: false, requests: false}, coverage: 'Latest rows only.'},
  '/api/email-settings': {settings: {owner_alerts: true, weekly_digest: true, new_leads: true}, log: [], transport: 'dry_run', canEdit: true, caps: 'Per workspace per UTC day: 20 owner alerts.'},
  '/api/tickets': {tickets: [], truncated: false, limit: 200},
  '/api/history': {conversations: [], total: 0, truncated: false, retentionDays: 90, role: 'owner', coverage: 'Latest 300 conversations.'},
  '/api/leads': {leads: [], total: 0, limit: 500, role: 'owner', coverage: 'Consented contact emails from widget requests, latest 500.'},
  '/api/knowledge': {documents: [], attempts: [], usage: {sources: 0, pageUnits: 0}},
  '/api/knowledge/custom': {responses: []},
  '/api/knowledge/refresh': {settings: {frequency: 'off', sitemap_url: null, last_run_at: null, next_due_at: null, last_summary: null}, items: [], limits: 'Each run re-checks up to 15 saved pages.'},
};
const PUBLIC = [['/', 'home'], ['/pricing', 'pricing'], ['/docs', 'docs'], ['/contact', 'contact'], ['/login', 'login'], ['/status', 'status'], ['/privacy', 'privacy'], ['/terms', 'terms'], ['/security', 'security'], ['/legal/dpa', 'dpa'], ['/legal/subprocessors', 'subprocessors'], ['/legal/delete-account', 'delete-account']];
const OWNER = ['/owner', '/tickets', '/history', '/billing', '/support', '/leads', '/knowledge', '/team', '/setup', '/integrations', '/operations', '/sandbox-catalog'];
// Visible text and labelled attributes outside [data-demo], plus head metadata.
const collect = () => {
  const out = [];
  const skip = (el) => !el || el.closest('[data-demo],script,style,noscript,template');
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) if (!skip(t.parentElement) && t.textContent.trim()) out.push(t.textContent.trim());
  for (const el of document.body.querySelectorAll('[placeholder],[aria-label],[title],[alt]')) if (!skip(el)) for (const a of ['placeholder', 'aria-label', 'title', 'alt']) { const v = el.getAttribute(a); if (v) out.push(`${a}=${v}`); }
  out.push('title=' + document.title);
  for (const m of document.head.querySelectorAll('meta[name="description"],meta[property="og:description"],meta[name="twitter:description"],meta[property="og:image:alt"],meta[name="twitter:image:alt"],meta[property="og:title"]')) out.push(`meta=${m.getAttribute('content')}`);
  return out;
};
const demoText = () => [...document.querySelectorAll('[data-demo]')].map((e) => e.textContent).join(' ');
try {
  await waitServer();
  const st = await (await fetch(BASE + '/api/status')).json();
  assert.equal(st.mode, 'production', 'this gate needs a build made with APP_MODE=production'); assert.equal(st.billing, 'read-only'); assert.notEqual(st.proofPaymentExecution, true); ok();
  const b = await chromium.launch();
  try {
    const p = await b.newPage({viewport: {width: 1280, height: 900}});
    const errors = []; p.on('pageerror', (e) => errors.push(e.message));
    let answerMode = 'unanswered';
    await p.route('**/api/**', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.pathname === '/api/status') return r.continue();
      if (u.pathname === '/api/support') {
        if (req.method() === 'GET') return json(r, {case: CASE});
        const j = req.postDataJSON() ?? {};
        if (j.action === 'messages') return json(r, {inboxState: 'open', messages: []});
        if (j.action === 'answer') return json(r, answerMode === 'unanswered' ? {interactionId: 'i1', supported: false, answer: 'Not enough verified source information. A person can review this.', sources: []} : {});
        return json(r, {ok: true});
      }
      if (req.method() === 'GET' && MOCKS[u.pathname]) return json(r, MOCKS[u.pathname]);
      return json(r, {error: 'Not in this test.'}, 503);
    });
    const scan = async (label) => {
      const found = (await p.evaluate(collect)).filter((t) => BAD.test(t));
      assert.deepEqual(found, [], `${label}: production wording still says ${JSON.stringify(found.slice(0, 5))}`); ok();
    };
    for (const [path, label] of PUBLIC) {
      await p.goto(BASE + path, {waitUntil: 'networkidle'});
      await p.locator('h1').first().waitFor();
      await scan(label);
    }
    // The public status page agrees with /api/status.
    await p.goto(BASE + '/status', {waitUntil: 'networkidle'});
    assert.match(await p.locator('dl').innerText(), /Mode\s+Production/); ok();
    // The marketing demo stays clearly labelled as a demo.
    await p.goto(BASE + '/', {waitUntil: 'networkidle'});
    assert.match(await p.evaluate(demoText), /Scripted walkthrough on fictional data/); ok();
    for (const path of OWNER) {
      await p.goto(BASE + path, {waitUntil: 'networkidle'});
      await p.locator('h1').first().waitFor();
      await scan(path);
    }
    // The visitor widget (client-rendered): header, notice, form, consent, footer; then an unanswered question.
    await p.goto(`${BASE}/help?token=${TOKEN}`, {waitUntil: 'networkidle'});
    await p.getByText('Support chat', {exact: true}).waitFor(); await p.getByText('Never share card numbers or passwords.', {exact: false}).first().waitFor(); ok();
    await p.locator('#help-email').fill('visitor@example.com');
    await p.getByText('Allow the team to see the address for this request.', {exact: false}).waitFor(); ok();
    await scan('/help');
    assert.match(await p.evaluate(demoText), /Fictional fixture/, 'the sample order card stays labelled'); ok();
    await p.locator('#help-message').fill('Do you ship to Pune on Sundays?');
    await p.getByRole('button', {name: 'Ask a question'}).click();
    await p.getByText('Leave an email address and the team can follow up on this case.', {exact: false}).waitFor(); ok();
    await scan('/help after an unanswered question');
    assert.deepEqual(errors, [], errors.join(' | ')); ok();
    console.log(`PASS production mode: ${n} checks; /api/status and /status report production; ${PUBLIC.length} public pages, ${OWNER.length} owner pages and the client-rendered /help widget (before and after an unanswered question) show no "fictional", "demo fixture" or "enter real" wording outside elements marked data-demo, including title and meta; the home demo and the sample order card stay labelled; no page errors.`);
  } finally { await b.close(); }
} catch (e) { console.error('FAIL production mode:', e.message); process.exitCode = 1; }
finally { server.kill(); }
