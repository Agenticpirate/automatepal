// Phase 6 owner surfaces (WebKit, 390 and 1440, all /api calls intercepted, nothing reaches the database):
// Chat history (list, search, source filter, transcript, formula-safe CSV, two-step delete, retention, agent
// view, empty state), the Overview funnel's "Widget opened" step with the AI-topic / ticket-category toggle
// and pre-filled "Write an answer" links, the custom-response form pre-filled from ?answer=, the scheduled
// refresh queue (apply a changed page through /api/knowledge, then resolve), and the email notification
// toggles. No horizontal overflow and no console errors. Run `npm run build` first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {webkit} from '@playwright/test';
const PORT = 3286, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
let n = 0; const ok = () => n++;
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/api/status'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
const json = (r, body, status = 200) => r.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString(), H = 3600e3, D = 86400e3;
const C1 = 'a1000000-0000-4000-8000-000000000001', C2 = 'a2000000-0000-4000-8000-000000000002';
const CONVERSATIONS = [
  {id: C1, label: 'T-A1000000', created_at: iso(2 * D), last_at: iso(2 * H), status: 'open', inbox_state: 'open', source: 'widget', questions: 2, unanswered: 1, preview: 'Do you ship to Pune?', entries: [
    {at: iso(3 * H), author: 'visitor', text: 'Do you ship to Pune?'}, {at: iso(3 * H), author: 'ai', text: 'Not enough verified source information.', meta: 'not answered from sources'},
    {at: iso(2.5 * H), author: 'visitor', text: '=HYPERLINK("http://x") what now?'}, {at: iso(2 * H), author: 'owner', text: 'We ship there on Fridays.', meta: 'person chat'}]},
  {id: C2, label: 'T-A2000000', created_at: iso(5 * D), last_at: iso(4 * D), status: 'resolved', inbox_state: 'closed', source: 'hosted_page', questions: 1, unanswered: 0, preview: 'What is the refund policy?', entries: [
    {at: iso(4 * D), author: 'visitor', text: 'What is the refund policy?'}, {at: iso(4 * D), author: 'ai', text: 'Unopened kits within 30 days.', meta: 'answered from sources · rated helpful'}]},
];
const history = (role = 'owner', list = CONVERSATIONS) => ({conversations: list, total: list.length, truncated: false, retentionDays: 90, role, coverage: 'Latest 300 conversations.'});
const T = (id, ageH, extra = {}) => ({id, created_at: iso(ageH * H), order_label: 'Fictional order', inbox_state: 'open', ticket_status: 'open', priority: 'normal', category: 'billing', assigned_to_owner: true, ...extra});
const OVERVIEW = {asOf: new Date(now).toISOString(), tickets: [T(C1, 30), T(C2, 50, {category: 'refund'})],
  queries: [{id: 'q1', case_id: C1, created_at: iso(3 * H), question: 'Do you ship to Pune?', supported: false, feedback: null}, {id: 'q2', case_id: C2, created_at: iso(4 * D), question: 'What is the refund policy?', supported: true, feedback: 1}, {id: 'q3', case_id: C1, created_at: iso(2 * H), question: 'Do you deliver to Pune city?', supported: false, feedback: null}],
  requests: [], usage: {utcDay: new Date(now).toISOString().slice(0, 10), answersToday: 2, dailyLimit: 100, sources: 3, sourceLimit: 30, pageUnits: 4, pageLimit: 360}, truncated: {tickets: false, queries: false, requests: false}, coverage: 'Latest rows only.',
  insights: [{case_id: C1, topic: 'Shipping', sentiment: 'negative', outcome: 'unresolved', labeled_at: iso(H)}, {case_id: C2, topic: 'Refunds', sentiment: 'positive', outcome: 'resolved', labeled_at: iso(3 * D)}],
  opens: [{case_id: C1, day: new Date(now).toISOString().slice(0, 10), source: 'widget', opens: 3}, {case_id: C2, day: new Date(now - 4 * D).toISOString().slice(0, 10), source: 'hosted_page', opens: 1}, {case_id: 'a3000000-0000-4000-8000-000000000003', day: new Date(now - D).toISOString().slice(0, 10), source: 'widget', opens: 1}],
  insightSettings: {topics: ['Shipping', 'Refunds'], enabled: true}};
const DOC = {id: 'd1000000-0000-4000-8000-000000000001', title: 'Shipping FAQ', published: true, updated_at: '2026-10-30T10:00:00.000Z'};
try {
  await waitServer();
  const b = await webkit.launch();
  try {
    for (const vp of [{width: 390, height: 844}, {width: 1440, height: 900}]) {
      const tag = `@${vp.width}`;
      const p = await b.newPage({viewport: vp, acceptDownloads: true});
      const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const posts = []; let list = [...CONVERSATIONS], role = 'owner', email = {owner_alerts: true, weekly_digest: true, new_leads: true}, refreshItems = null;
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = new URL(req.url()), m = req.method();
        if (m === 'POST') { const j = req.postDataJSON(); posts.push({path: u.pathname, body: j});
          if (u.pathname === '/api/history') { if (j.action === 'delete') list = list.filter((c) => c.id !== j.id); return json(r, {note: j.action === 'delete' ? 'Conversation deleted: its transcript, ticket, requests and person chat are gone.' : `Transcripts are now kept for ${j.days} days.`}); }
          if (u.pathname === '/api/email-settings') { email = j; return json(r, {note: 'Email settings saved.'}); }
          if (u.pathname === '/api/knowledge/refresh') { if (j.action === 'resolve') refreshItems = []; return json(r, {note: 'Marked as applied.'}); }
          if (u.pathname === '/api/knowledge') return json(r, {note: 'Success. Published to your valid demo links.'});
          return json(r, {}); }
        if (u.pathname === '/api/history') return json(r, history(role, list));
        if (u.pathname === '/api/owner-overview') return json(r, OVERVIEW);
        if (u.pathname === '/api/owner-alerts') return json(r, {error: 'not in this test'}, 503);
        if (u.pathname === '/api/email-settings') return json(r, {settings: email, log: [{id: 'e1', created_at: iso(H), email_type: 'owner_alert', status: 'dry_run'}], transport: 'dry_run', canEdit: true, caps: 'Per workspace per UTC day: 20 owner alerts.'});
        if (u.pathname === '/api/knowledge') return json(r, {documents: [{...DOC, content: 'Source: https://shop.example/faq\n\nOld text', created_at: DOC.updated_at, source_kind: 'text', applicability: '', effective_from: null, effective_until: null, pending_approval: false}], attempts: [], usage: {sources: 1, pageUnits: 1}});
        if (u.pathname === '/api/knowledge/custom') return json(r, {responses: []});
        if (u.pathname === '/api/knowledge/refresh') return json(r, {settings: {frequency: 'weekly', sitemap_url: null, last_run_at: iso(D), next_due_at: iso(-6 * D), last_summary: {checked: 1, changed: 1, added: 0, removed: 0, sitemap: 'none'}}, items: refreshItems ?? [{id: 'r1000000-0000-4000-8000-000000000001', document_id: DOC.id, url: 'https://shop.example/faq', kind: 'changed', title: 'Shipping FAQ', content: 'Source: https://shop.example/faq\n\nNew shipping text: we ship to Pune on Fridays.', detected_at: iso(D), document: DOC}], limits: 'Each run re-checks up to 15 saved pages.'});
        return json(r, {});
      });
      // ---- Chat history ----
      await p.goto(BASE + '/history');
      await p.getByRole('heading', {name: 'Chat history', level: 1}).waitFor(); ok();
      const conv = p.getByRole('list', {name: 'Conversations'});
      await conv.getByText('Do you ship to Pune?').waitFor();
      assert.equal(await conv.getByRole('listitem').count(), 2, tag); ok();
      await p.getByLabel('Search transcripts').fill('fridays');
      assert.equal(await conv.getByRole('listitem').count(), 1, 'search covers team replies'); ok();
      await p.getByLabel('Search transcripts').fill('');
      await p.getByLabel('Source').selectOption('hosted_page');
      assert.equal(await conv.getByRole('listitem').count(), 1); await conv.getByText('What is the refund policy?').waitFor(); ok();
      await p.getByLabel('Source').selectOption('all');
      await p.getByRole('button', {name: 'Open transcript T-A1000000'}).click();
      const tr = p.getByRole('region', {name: 'Transcript T-A1000000'});
      await tr.getByText('We ship there on Fridays.').waitFor(); await tr.getByText('AI answer', {exact: true}).waitFor(); ok();
      const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', {name: 'Export CSV'}).click()]);
      const csv = fs.readFileSync(await dl.path(), 'utf8').split('\n');
      assert.equal(csv[0], 'Conversation,Full ID,Status,Source,Time UTC,Author,Text,Note'); assert.equal(csv.length, 7); assert.ok(csv.some((l) => l.includes(`"'=HYPERLINK(""http://x"") what now?"`)), 'formula escaped'); ok();
      await p.getByRole('button', {name: 'Delete conversation T-A2000000'}).click();
      assert.equal(posts.filter((x) => x.path === '/api/history').length, 0, 'first click only asks to confirm'); ok();
      await p.getByRole('button', {name: 'Confirm delete'}).click();
      await p.getByText('Conversation deleted', {exact: false}).waitFor();
      assert.deepEqual(posts.at(-1), {path: '/api/history', body: {action: 'delete', id: C2}}); await p.waitForFunction(() => document.querySelectorAll('[aria-label="Conversations"] > li').length === 1); ok();
      await p.getByRole('button', {name: '30 days'}).click();
      await p.getByText('Transcripts are now kept for 30 days.').waitFor(); assert.deepEqual(posts.at(-1).body, {action: 'retention', days: 30}); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'history overflow ' + tag); ok();
      await p.waitForLoadState('networkidle');
      role = 'agent'; await p.goto(BASE + '/history'); await p.getByRole('heading', {name: 'Chat history', level: 1}).waitFor(); await p.getByRole('list', {name: 'Conversations'}).waitFor();
      assert.equal(await p.getByRole('button', {name: /^Delete conversation/}).count(), 0, 'agents cannot delete'); assert.equal(await p.getByRole('button', {name: '365 days'}).isDisabled(), true); ok();
      await p.waitForLoadState('networkidle');
      list = []; role = 'owner'; await p.goto(BASE + '/history'); await p.getByText('No conversations yet.', {exact: false}).waitFor(); ok();
      // ---- Overview: funnel, topics toggle, write-an-answer links, email settings ----
      await p.waitForLoadState('networkidle');
      await p.goto(BASE + '/owner');
      await p.getByRole('heading', {name: 'Conversation funnel'}).waitFor();
      const funnel = p.getByRole('list', {name: 'Conversation funnel'});
      await funnel.getByText('Widget opened').waitFor(); ok();
      await p.getByRole('heading', {name: 'Conversation topics', exact: true}).waitFor(); await p.getByRole('img', {name: /Conversation topics: Shipping 1/}).waitFor(); ok();
      await p.getByRole('button', {name: 'Ticket category'}).click(); await p.getByRole('heading', {name: 'Tickets by category'}).waitFor();
      await p.getByRole('button', {name: 'AI topics'}).click(); await p.getByRole('heading', {name: 'Conversation topics', exact: true}).waitFor(); ok();
      const href = await p.getByRole('link', {name: /^Write an answer/}).first().getAttribute('href');
      assert.match(href, /^\/knowledge\?answer=Do%20you%20(ship|deliver)%20to%20Pune/, href); assert.ok(href.endsWith('#custom-responses')); ok();
      const es = p.locator('#email-settings');
      await es.getByText('Email delivery is off on this server', {exact: false}).waitFor(); ok();
      await es.getByRole('checkbox', {name: /Weekly digest/}).uncheck();
      await p.getByText('Email settings saved.').waitFor(); assert.deepEqual(posts.at(-1), {path: '/api/email-settings', body: {owner_alerts: true, weekly_digest: false, new_leads: true}}); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'owner overflow ' + tag); ok();
      // ---- Knowledge: pre-filled custom response, scheduled refresh apply ----
      await p.waitForLoadState('networkidle'); // let link prefetches finish; WebKit logs aborted ones as errors
      await p.goto(BASE + href);
      await p.waitForFunction(() => { const i = document.querySelector('#custom-responses input'); return i && /Pune/.test(i.value); }); ok();
      const sr = p.locator('#scheduled-refresh');
      await sr.getByText('Waiting for review (1)').waitFor();
      assert.equal(await sr.getByRole('button', {name: 'Update source'}).isDisabled(), true, 'consent first'); ok();
      await sr.getByRole('checkbox', {name: /I consent to processing/}).check();
      await sr.getByRole('button', {name: 'Update source'}).click();
      await sr.getByText('Source updated. Its publication setting is unchanged.').waitFor();
      const save = posts.find((x) => x.path === '/api/knowledge'), resolve = posts.find((x) => x.path === '/api/knowledge/refresh' && x.body.action === 'resolve');
      assert.equal(save.body.id, DOC.id); assert.equal(save.body.expected, DOC.updated_at); assert.equal(save.body.input.published, true); assert.equal(save.body.input.processingConsent, true); assert.match(save.body.input.content, /Pune on Fridays/); ok();
      assert.deepEqual(resolve.body, {action: 'resolve', id: 'r1000000-0000-4000-8000-000000000001', status: 'applied'}); assert.ok(posts.indexOf(save) < posts.indexOf(resolve), 'saved before marked applied'); ok();
      await sr.getByText('No changes waiting.').waitFor(); ok();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'knowledge overflow ' + tag); ok();
      assert.deepEqual(errors.filter((e) => !/Failed to load resource.*503/.test(e)), [], errors.join(' | ')); ok();
      await p.close();
    }
    console.log(`PASS production UI: ${n} checks at 390 and 1440; chat history search/filter/transcript/CSV/delete/retention/agent/empty, funnel with Widget opened, topics toggle, pre-filled Write an answer links and form, scheduled refresh apply through Knowledge then resolve, email toggles; no overflow or console errors.`);
  } finally { await b.close(); }
} finally { server.kill(); }
