// Leads page (WebKit, 390 and 1440): list, search, two-step delete posting {action:'delete',id}, CSV export with
// formula escaping, the manager-role refusal and the empty state, plus the Leads nav link. All /api calls are
// intercepted; nothing reaches the database. Run `npm run build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {webkit} from '@playwright/test';
const PORT = 3264, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
let n = 0;
const ok = () => n++;
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/leads'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
const json = (r, body, status = 200) => r.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
const COVERAGE = 'Consented contact emails from widget requests, latest 500. Nothing is forwarded to email or a CRM.';
const LEADS = [
  {id: '11111111-1111-4111-8111-111111111111', case_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: '2026-11-01T10:00:00.000Z', kind: 'lead_callback', contact_email: 'fictional-buyer@example.com'},
  {id: '22222222-2222-4222-8222-222222222222', case_id: null, created_at: '2026-10-31T09:00:00.000Z', kind: 'human_handoff', contact_email: '+formula-test@example.com'},
  {id: '33333333-3333-4333-8333-333333333333', case_id: null, created_at: '2026-10-30T09:00:00.000Z', kind: 'lead_callback', contact_email: 'a.very.long.fictional.address.that.must.wrap.cleanly@subdomain.example-merchant.com'},
];
try {
  await waitServer();
  const b = await webkit.launch();
  try {
    for (const vp of [{width: 390, height: 844}, {width: 1440, height: 900}]) {
      const p = await b.newPage({viewport: vp, acceptDownloads: true});
      const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      let rows = [...LEADS]; const posts = [];
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/leads') && req.method() === 'GET') return json(r, {leads: rows, total: rows.length, limit: 500, role: 'manager', coverage: COVERAGE});
        if (u.includes('/api/leads')) { const j = req.postDataJSON(); posts.push(j); rows = rows.filter((x) => x.id !== j.id); return json(r, {note: 'Lead deleted: the email address and consent were removed. The request itself stays in Tickets.'}); }
        return json(r, {});
      });
      await p.goto(BASE + '/leads');
      await p.getByRole('heading', {name: 'Leads', level: 1}).waitFor(); ok();
      const list = p.getByRole('list', {name: 'Leads'});
      await list.getByText('fictional-buyer@example.com').waitFor(); ok();
      assert.equal(await list.getByRole('listitem').count(), 3); ok();
      await p.getByText('Nothing is forwarded to email or a CRM.', {exact: false}).first().waitFor(); ok();
      assert.ok(await p.getByRole('link', {name: 'Leads'}).first().isVisible() || vp.width < 900, 'Leads nav link'); ok();
      assert.equal(await p.locator('a[href="/leads"]').count() >= 1, true); ok();
      // Search.
      await p.getByLabel('Search leads').fill('FORMULA');
      assert.equal(await list.getByRole('listitem').count(), 1); ok();
      await p.getByLabel('Search leads').fill('handoff');
      await list.getByText('+formula-test@example.com').waitFor(); ok();
      await p.getByLabel('Search leads').fill('nobody-matches');
      await p.getByText('No leads match', {exact: false}).waitFor(); ok();
      assert.equal(await p.getByRole('button', {name: 'Export CSV'}).isDisabled(), true, 'nothing to export'); ok();
      await p.getByLabel('Search leads').fill('');
      // Export CSV: formula-safe, every lead shown.
      const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', {name: 'Export CSV'}).click()]);
      assert.match(download.suggestedFilename(), /^automatepal-leads-\d{4}-\d{2}-\d{2}\.csv$/); ok();
      const csv = fs.readFileSync(await download.path(), 'utf8').split('\n');
      assert.equal(csv[0], 'Email,Captured UTC,Request kind,Request ID,Conversation ID'); ok();
      assert.equal(csv.length, 4); ok();
      assert.ok(csv[2].startsWith(`"'+formula-test@example.com"`), csv[2]); ok();
      await p.getByText('Exported 3 leads as CSV. Nothing was sent anywhere.').waitFor(); ok();
      // Two-step delete.
      await p.getByRole('button', {name: 'Delete lead fictional-buyer@example.com'}).click();
      assert.equal(posts.length, 0, 'first click only asks to confirm'); ok();
      await p.getByRole('button', {name: 'Cancel'}).click();
      await p.getByRole('button', {name: 'Delete lead fictional-buyer@example.com'}).click();
      await p.getByRole('button', {name: 'Confirm delete'}).click();
      await p.getByText('Lead deleted: the email address and consent were removed.', {exact: false}).waitFor(); ok();
      assert.deepEqual(posts, [{action: 'delete', id: LEADS[0].id}]); ok();
      await p.waitForFunction(() => document.querySelectorAll('[aria-label="Leads"] li').length === 2); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${vp.width}`); ok();
      assert.deepEqual(errors, [], errors.join(' | ')); ok();
      // Agents get the API's 403 message and no list.
      await p.unroute('**/api/**');
      await p.route('**/api/**', (r) => r.request().url().includes('/api/leads') ? json(r, {error: 'Only managers, admins and the owner can see and manage leads.'}, 403) : json(r, {}));
      await p.goto(BASE + '/leads');
      await p.getByRole('alert').getByText('Only managers, admins and the owner can see and manage leads.').waitFor(); ok();
      assert.equal(await p.getByRole('list', {name: 'Leads'}).count(), 0); assert.equal(await p.getByRole('button', {name: 'Export CSV'}).count(), 0); ok();
      // Empty state.
      await p.unroute('**/api/**');
      await p.route('**/api/**', (r) => r.request().url().includes('/api/leads') ? json(r, {leads: [], total: 0, limit: 500, role: 'owner', coverage: COVERAGE}) : json(r, {}));
      await p.goto(BASE + '/leads');
      await p.getByText('No leads yet.', {exact: false}).waitFor(); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); ok();
      await p.close();
    }
    console.log(`PASS leads UI: ${n} checks at 390 and 1440; list, search, CSV export with formula escaping, two-step delete posting the id, manager refusal, empty state, no overflow or console errors.`);
  } finally { await b.close(); }
} finally { server.kill(); }
