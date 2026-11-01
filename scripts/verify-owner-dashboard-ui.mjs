// Owner overview A3 layout gate: desktop/tablet/mobile, populated and empty fixtures, no page overflow,
// no console errors, KPI change chips, range toggle, funnel, donut, status bar, table search/filter/paging,
// stacked table rows on mobile, honest empty states, zero mutation requests. Production build required.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
const PORT = 3263, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('npm', ['run', 'start', '--', '--port', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
const ok = (n) => console.log('PASS', n);
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/owner'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 1000)); } throw Error('no server'); }
const now = Date.now(), DAY = 86400000, iso = (ms) => new Date(now - ms).toISOString();
const ticket = (i, ageDays, extra = {}) => ({id: `c0000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, created_at: iso(ageDays * DAY), order_label: `Fictional order ${i}`, inbox_state: 'open', ticket_status: 'open', priority: 'normal', category: 'knowledge', assigned_to_owner: true, ...extra});
// 14 tickets in the last 7 days, 2 in the 7 days before; one very long label to stress wrapping.
const tickets = [
  ...Array.from({length: 14}, (_, i) => ticket(i + 1, 1 + (i % 6), {ticket_status: ['open', 'new', 'resolved', 'in_progress'][i % 4], category: ['knowledge', 'billing', 'refund', 'handoff', 'shipping'][i % 5], priority: i === 3 ? 'urgent' : 'normal', order_label: i === 0 ? 'Fictional order with an exceptionally long label that must wrap without pushing the table off the screen on a phone' : `Fictional order ${i + 1}`})),
  ticket(15, 9), ticket(16, 10, {ticket_status: 'closed'}),
];
const queries = [
  {id: 'q1', case_id: tickets[0].id, created_at: iso(1 * DAY), question: 'Do you ship to Pune?', supported: false, feedback: null},
  {id: 'q2', case_id: tickets[1].id, created_at: iso(2 * DAY), question: 'Do you ship to Pune quickly?', supported: false, feedback: null},
  {id: 'q3', case_id: tickets[2].id, created_at: iso(2 * DAY), question: 'What are your opening hours?', supported: true, feedback: 1},
  {id: 'q4', case_id: tickets[3].id, created_at: iso(3 * DAY), question: 'Can I change my plan?', supported: true, feedback: -1},
  {id: 'q5', case_id: tickets[14].id, created_at: iso(9 * DAY), question: 'Older answered question', supported: true, feedback: null},
];
const requests = [
  {id: 'r1', case_id: tickets[3].id, created_at: iso(3 * DAY), kind: 'human_handoff', status: 'pending_review'},
  {id: 'r2', case_id: tickets[2].id, created_at: iso(2 * DAY), kind: 'lead_callback', status: 'pending_review'},
  {id: 'r3', case_id: tickets[14].id, created_at: iso(9 * DAY), kind: 'human_handoff', status: 'reviewed_no_action'},
];
const usage = {utcDay: new Date(now).toISOString().slice(0, 10), answersToday: 4, dailyLimit: 100, sources: 3, sourceLimit: 30, pageUnits: 5, pageLimit: 360};
const populated = {asOf: new Date(now).toISOString(), tickets, queries, requests, usage, truncated: {}, coverage: 'Fixture coverage.'};
const empty = {asOf: new Date(now).toISOString(), tickets: [], queries: [], requests: [], usage: {...usage, answersToday: 0, sources: 0, pageUnits: 0}, truncated: {}, coverage: ''};
const alerts = {preferences: {channel: 'telegram', minimum_priority: 'high', quiet_start: 22, quiet_end: 7, timezone: 'Asia/Kolkata', digest: true, reasons: []}, log: [], eligible_now: [], eligible_count: 0, coverage: ''};

try {
  await waitServer();
  const b = await chromium.launch(process.env.PW_CHANNEL ? {channel: process.env.PW_CHANNEL} : {});
  try {
    for (const [name, vp] of [['desktop', {width: 1440, height: 900}], ['tablet', {width: 820, height: 1180}], ['mobile', {width: 390, height: 844}]]) {
      for (const [fixtureName, fixture] of [['populated', populated], ['empty', empty]]) {
        const p = await b.newPage({viewport: vp});
        const errors = [], mutations = [];
        p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        p.on('pageerror', (e) => errors.push(e.message));
        await p.route('**/api/**', (r) => {
          const u = r.request().url();
          if (r.request().method() !== 'GET') mutations.push(r.request().method() + ' ' + u);
          const body = u.includes('/api/owner-overview') ? fixture : u.includes('/api/owner-alerts') ? alerts : {};
          r.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
        });
        await p.goto(BASE + '/owner'); await p.waitForLoadState('networkidle');
        await p.getByText('Last 7 days (from the loaded snapshot):').waitFor({state: 'visible', timeout: 15000});
        const tag = `${name} ${fixtureName}`;
        assert.equal(await p.locator('.ap-od-kpi').count(), 4, tag + ' 4 KPI cards');
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 0, `${tag} page overflow ${overflow}px`);

        if (fixtureName === 'populated') {
          const kpiText = (await p.locator('.ap-od-kpi').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
          // 14 conversations now vs 2 before = +600%; handoffs 1 vs 1 = 0 (no change); leads 1 vs 0 = new.
          assert.ok(kpiText[0].includes('14') && kpiText[0].includes('+600%'), tag + ' conversations KPI ' + kpiText[0]);
          assert.ok(kpiText[1].includes('50%'), tag + ' answered rate KPI ' + kpiText[1]);
          assert.ok(/→ 0%/.test(kpiText[2]), tag + ' handoffs KPI no change ' + kpiText[2]);
          assert.ok(kpiText[3].includes('new'), tag + ' leads KPI new ' + kpiText[3]);
          ok(tag + ' KPI values and change chips');
          const funnel = (await p.locator('.ap-od-funnel ol li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
          assert.equal(funnel.length, 4, tag + ' 4 funnel steps');
          assert.ok(funnel[1].includes('4') && funnel[2].includes('2') && funnel[3].includes('1'), tag + ' funnel ' + funnel.join(' | '));
          assert.ok((await p.locator('.ap-od-donut li').allInnerTexts()).some((t) => t.includes('Shipping')), tag + ' donut lists data-driven categories');
          assert.ok((await p.locator('.ap-od-seg .ap-od-legend li').allInnerTexts()).some((t) => t.includes('In progress')), tag + ' status bar lists in-progress');
          ok(tag + ' funnel, donut and status bar');
          // table: 16 tickets -> 2 pages; filter; search; questions tab
          await p.getByText('Page 1 of 2').waitFor({state: 'visible'});
          await p.getByRole('button', {name: 'Next'}).click();
          await p.getByText('Page 2 of 2').waitFor({state: 'visible'});
          await p.locator('.ap-od-filter select').selectOption('closed');
          assert.equal(await p.locator('table.ap-od-tbl tbody tr').count(), 1, tag + ' closed filter shows 1 row from page 1');
          await p.locator('.ap-od-filter select').selectOption('all');
          await p.getByRole('button', {name: 'Questions', exact: true}).click();
          assert.equal(await p.locator('table.ap-od-tbl tbody tr').count(), 5, tag + ' questions tab shows 5');
          await p.locator('.ap-od-filter select').selectOption('unanswered');
          assert.equal(await p.locator('table.ap-od-tbl tbody tr').count(), 2, tag + ' unanswered filter');
          assert.ok(await p.getByRole('link', {name: 'Write an answer'}).count() >= 2, tag + ' write-an-answer actions');
          ok(tag + ' table paging, status filter, questions tab');
          await p.getByRole('button', {name: '30 days'}).click();
          await p.getByText('Last 30 days (from the loaded snapshot):').waitFor({state: 'visible'});
          const conv30 = (await p.locator('.ap-od-kpi').first().innerText()).replace(/\s+/g, ' ');
          assert.ok(conv30.includes('16') && conv30.includes('no prior data') === false, tag + ' 30-day KPI ' + conv30);
          ok(tag + ' range toggle recomputes KPIs');
          if (name === 'mobile') {
            const display = await p.locator('table.ap-od-tbl tbody tr').first().evaluate((el) => getComputedStyle(el).display);
            assert.equal(display, 'block', tag + ' table rows stack on mobile');
            ok(tag + ' table rows stack');
          }
          const overflowAfter = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert.ok(overflowAfter <= 0, `${tag} overflow after interaction ${overflowAfter}px`);
        } else {
          await p.getByText('Not enough data yet. Conversations in this range will show here.').waitFor({state: 'visible'});
          await p.getByText('No tickets opened in this range.').waitFor({state: 'visible'});
          await p.getByText('No conversations yet.').waitFor({state: 'visible'});
          await p.getByRole('link', {name: 'Finish Quick setup'}).waitFor({state: 'visible'});
          assert.equal(await p.locator('.ap-od-kpi .ap-od-delta-good, .ap-od-kpi .ap-od-delta-bad').count(), 0, tag + ' no fake changes on empty data');
          ok(tag + ' honest empty states');
        }
        assert.deepEqual(errors, [], tag + ' console errors');
        assert.equal(mutations.length, 0, tag + ' mutations ' + mutations.join(','));
        ok(tag + ' no overflow, no console errors, no mutations');
        await p.close();
      }
    }
  } finally { await b.close(); }
  console.log('all owner dashboard checks passed');
} finally { server.kill(); }
