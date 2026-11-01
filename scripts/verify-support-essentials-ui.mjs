// Support essentials UI (WebKit): the visitor's live thread with a person (polled owner message, visitor
// reply posts visitor_message), the AI-or-person chooser with open and closed working hours, the owner
// conversation inbox (participants chip, AI-paused state, composer only when taken over, reply posts
// `reply`), and the /support working hours panel saving `workingHours`. All /api calls are intercepted;
// nothing reaches the database. Run `npm run build` first.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {webkit} from '@playwright/test';
const PORT = 3262, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, NEXT_PUBLIC_DEMO_OPEN: 'false'}});
let n = 0;
const ok = () => n++;
async function waitServer() { const dl = Date.now() + 60000; while (Date.now() < dl) { try { const r = await fetch(BASE + '/help'); if (r.status < 500) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw Error('no server'); }
const json = (r, body, status = 200) => r.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
const future = () => new Date(Date.now() + 3600000).toISOString();
const baseCase = (inboxState, controls = {}) => ({order: 'Fictional Launch Kit order', amount: 19, currency: 'USD', status: 'Sandbox fixture', inboxState, expiresAt: future(), branding: {label: 'Site help', initials: 'AP', prompts: [], color: '#233de8'}, controls, billing: null});
const AWAY = 'Fictional store: we are away until Monday 09:00.';
const noOverflow = async (p, label) => { assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} overflow`); ok(); };
const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
const tickets = [
  {id: '22222222-2222-4222-8222-222222222222', created_at: iso(7200000), expires_at: future(), order_label: 'Fictional Starter Box order', inbox_state: 'open', ticket_status: 'open', priority: 'normal', category: 'billing', tags: [], assigned_to_owner: true, first_reviewed_at: null, ticket_updated_at: iso(600000), ticket_type: 'question', impact: 3, urgency: 2, assignment_queue: 'general', review_decision: 'not_requested', related_ticket: null},
  {id: '33333333-3333-4333-8333-333333333333', created_at: iso(3600000), expires_at: future(), order_label: 'Fictional Refill Pack order', inbox_state: 'taken_over', ticket_status: 'pending', priority: 'high', category: 'handoff', tags: [], assigned_to_owner: true, first_reviewed_at: iso(3000000), ticket_updated_at: iso(60000), ticket_type: 'question', impact: 3, urgency: 2, assignment_queue: 'general', review_decision: 'not_requested', related_ticket: null},
];
const timeline = (id) => ({events: [{id: 'e-' + id, created_at: iso(3000000), kind: 'owner_update', body: 'State: pending; AI: taken_over'}], requests: [], questions: [], payments: [],
  messages: id.startsWith('3333') ? [{id: 'm1', created_at: iso(120000), author: 'owner', body: 'Hi, I am the fictional owner.'}, {id: 'm2', created_at: iso(90000), author: 'visitor', body: 'Thanks for joining.'}] : [],
  coverage: 'Recorded questions, review requests, internal events and widget replies. AI answer bodies are not stored here. Nothing is emailed.'});

try {
  await waitServer();
  const b = await webkit.launch();
  try {
    for (const vp of [{width: 390, height: 844}, {width: 820, height: 1000}, {width: 1440, height: 900}]) {
      const p = await b.newPage({viewport: vp});
      const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const posts = [];

      // 1. Taken-over case: polled owner message, visitor reply posts visitor_message.
      let thread = [{id: 'o1', author: 'owner', body: 'Hello from the fictional team. How can I help?', created_at: new Date().toISOString()}];
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/support') && req.method() === 'GET') return json(r, {case: baseCase('taken_over')});
        if (u.includes('/api/support')) {
          const j = req.postDataJSON(); posts.push(j);
          if (j.action === 'messages') return json(r, {inboxState: 'taken_over', messages: j.after ? thread.filter((m) => m.created_at > j.after) : thread});
          if (j.action === 'visitor_message') { thread = [...thread, {id: 'v1', author: 'visitor', body: j.body, created_at: new Date(Date.now() + 1000).toISOString()}]; return json(r, {id: 'v1', note: 'Message sent to the team in this chat. Nothing is emailed.'}); }
          return json(r, {note: 'ok'});
        }
        return json(r, {});
      });
      await p.goto(BASE + '/help?token=' + 'b'.repeat(64));
      const chat = p.getByRole('region', {name: 'Conversation with a person'});
      await chat.getByText('Hello from the fictional team. How can I help?').waitFor(); ok();
      await chat.getByText('AI answers are paused.', {exact: false}).waitFor(); ok();
      assert.equal(await p.getByRole('group', {name: 'How would you like help?'}).count(), 0, 'no chooser while taken over'); ok();
      assert.equal(await p.getByRole('button', {name: 'Ask a question'}).isDisabled(), true, 'AI paused'); ok();
      await chat.getByLabel('Your reply').fill('My fictional order is DEMO-1.');
      await chat.getByRole('button', {name: 'Send to the team'}).click();
      await chat.getByText('Message sent to the team in this chat.', {exact: false}).waitFor(); ok();
      assert.deepEqual(posts.filter((x) => x.action === 'visitor_message').map((x) => x.body), ['My fictional order is DEMO-1.']); ok();
      await chat.getByText('My fictional order is DEMO-1.', {exact: true}).waitFor(); ok();
      assert.ok(posts.filter((x) => x.action === 'messages').every((x) => x.token === 'b'.repeat(64)), 'polls carry the token'); ok();
      await noOverflow(p, `help thread ${vp.width}`);

      // 2a. Closed hours: away message and the follow-up email path; handoff still posts.
      await p.unroute('**/api/**');
      const closed = {visitorChoice: true, workingHours: {enabled: true, timezone: 'Asia/Kolkata', days: [], awayMessage: AWAY}};
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/support') && req.method() === 'GET') return json(r, {case: baseCase('open', closed)});
        if (u.includes('/api/support')) { const j = req.postDataJSON(); posts.push(j); if (j.action === 'messages') return json(r, {inboxState: 'open', messages: []}); if (j.action === 'request') return json(r, {id: 'h1', note: AWAY + ' Your request is saved for the team.', open: false}); return json(r, {note: 'ok'}); }
        return json(r, {});
      });
      await p.goto(BASE + '/help?token=' + 'c'.repeat(64));
      const chooser = p.getByRole('group', {name: 'How would you like help?'});
      await chooser.getByText(AWAY, {exact: true}).waitFor(); ok();
      await chooser.getByRole('button', {name: 'Leave an email for a follow-up'}).waitFor(); ok();
      await chooser.getByRole('button', {name: 'Talk to a person'}).click();
      await p.getByText(AWAY + ' Your request is saved for the team.').waitFor(); ok();
      const handoff = posts.filter((x) => x.action === 'request').at(-1);
      assert.equal(handoff.kind, 'human_handoff'); assert.ok(handoff.message.length >= 5); ok();
      await chooser.getByRole('button', {name: 'Ask the AI'}).click();
      assert.equal(await p.evaluate(() => document.activeElement?.id), 'help-message', 'Ask the AI focuses the question box'); ok();
      // Ask a person to review and Ask a question stay.
      await p.getByRole('button', {name: 'Ask a person to review'}).waitFor(); await p.getByRole('button', {name: 'Ask a question'}).waitFor(); ok();

      // 2b. Open hours (disabled working hours = always open): joined note.
      await p.unroute('**/api/**');
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/support') && req.method() === 'GET') return json(r, {case: baseCase('open', {workingHours: {enabled: false, timezone: 'UTC', days: [], awayMessage: AWAY}})});
        if (u.includes('/api/support')) { const j = req.postDataJSON(); posts.push(j); if (j.action === 'messages') return json(r, {inboxState: 'open', messages: []}); if (j.action === 'request') return json(r, {id: 'h2', note: 'A person has been asked to join this chat. Replies appear here. Nothing is emailed.', open: true}); return json(r, {note: 'ok'}); }
        return json(r, {});
      });
      await p.goto(BASE + '/help?token=' + 'd'.repeat(64));
      const chooser2 = p.getByRole('group', {name: 'How would you like help?'});
      await chooser2.getByText('A person can join this chat now.', {exact: false}).waitFor(); ok();
      assert.equal(await p.getByText(AWAY).count(), 0, 'no away message while open'); ok();
      await chooser2.getByRole('button', {name: 'Talk to a person'}).click();
      await p.getByText('A person has been asked to join this chat. Replies appear here. Nothing is emailed.').waitFor(); ok();
      // visitorChoice false hides the chooser.
      await p.unroute('**/api/**');
      await p.route('**/api/**', (r) => { const req = r.request(), u = req.url(); if (u.includes('/api/support') && req.method() === 'GET') return json(r, {case: baseCase('open', {visitorChoice: false})}); if (u.includes('/api/support')) return json(r, {inboxState: 'open', messages: []}); return json(r, {}); });
      await p.goto(BASE + '/help?token=' + 'e'.repeat(64));
      await p.getByText('Clear answers. A person when needed.').waitFor();
      await p.getByRole('button', {name: 'Ask a question'}).waitFor();
      assert.equal(await p.getByRole('group', {name: 'How would you like help?'}).count(), 0, 'chooser off'); ok();
      await noOverflow(p, `help chooser ${vp.width}`);

      // 3. Owner inbox: empty state, participants chip, composer only when taken over, reply posts `reply`.
      await p.unroute('**/api/**');
      const ticketPosts = [];
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/tickets') && req.method() === 'POST') { ticketPosts.push(req.postDataJSON()); return json(r, {note: "Reply shown in the visitor's widget. Nothing was emailed."}); }
        if (u.includes('/api/tickets?id=')) return json(r, timeline(new URL(u).searchParams.get('id')));
        if (u.includes('/api/tickets')) return json(r, {tickets, truncated: false, limit: 200});
        return json(r, {});
      });
      await p.goto(BASE + '/tickets');
      await p.getByText('Fictional Refill Pack order').first().waitFor();
      if (vp.width >= 1080) { await p.getByRole('heading', {name: 'Pick a conversation'}).waitFor(); ok(); }
      const list = p.getByRole('region', {name: 'Ticket list'});
      await list.getByText('Owner took over. AI paused; replies go to the widget.').waitFor(); ok();
      // Open (not taken over): composer offers takeover, no reply box.
      await p.getByRole('button', {name: 'T-22222222', exact: true}).click();
      await p.getByRole('group', {name: /Participants: AI assistant \(answering\)/}).waitFor(); ok();
      await p.getByRole('tab', {name: 'Reply in widget'}).click();
      await p.getByText('Take over to reply in the widget.').waitFor(); ok();
      assert.equal(await p.getByLabel('Reply to the visitor in the widget').count(), 0, 'no reply box before takeover'); ok();
      if (vp.width < 1080) await p.getByRole('button', {name: 'All tickets'}).click();
      // Taken over: AI paused visible, thread shows widget messages, reply posts.
      await p.getByRole('button', {name: 'T-33333333', exact: true}).click();
      await p.getByRole('group', {name: /Participants: AI assistant \(paused\), owner \(replying in the widget\), visitor/}).waitFor(); ok();
      await p.getByText('Taken over · AI paused').filter({visible: true}).first().waitFor(); ok();
      await p.getByText('Hi, I am the fictional owner.').waitFor(); await p.getByText('Thanks for joining.').waitFor(); ok();
      await p.getByText('Reply in widget ·', {exact: false}).first().waitFor(); ok();
      await p.getByText("Shown live in the visitor's widget only. Nothing is emailed.", {exact: false}).waitFor(); ok();
      await p.getByLabel('Reply to the visitor in the widget').fill('Your fictional refill ships Friday.');
      await p.getByRole('button', {name: 'Send reply in widget'}).click();
      await p.getByText("Reply shown in the visitor's widget. Nothing was emailed.").waitFor(); ok();
      assert.deepEqual(ticketPosts.filter((x) => x.action === 'reply'), [{action: 'reply', id: '33333333-3333-4333-8333-333333333333', body: 'Your fictional refill ships Friday.'}]); ok();
      // More actions menu: pin the conversation (browser-local) and close with Escape.
      await p.getByRole('button', {name: 'More actions'}).click();
      await p.getByRole('menuitem', {name: 'Pin conversation'}).click();
      await p.getByText('Conversation pinned on this browser.').waitFor(); ok();
      await p.getByRole('button', {name: 'More actions'}).click();
      await p.getByRole('menuitem', {name: 'Unpin conversation'}).waitFor();
      await p.keyboard.press('Escape');
      assert.equal(await p.getByRole('menu', {name: 'More actions'}).count(), 0, 'Escape closes the menu'); ok();
      await noOverflow(p, `tickets ${vp.width}`);

      // 4. /support working hours panel saves workingHours through the settings action.
      await p.unroute('**/api/**');
      let saved = null;
      await p.route('**/api/**', (r) => {
        const req = r.request(), u = req.url();
        if (u.includes('/api/support') && req.method() === 'POST') { saved = req.postDataJSON(); return json(r, {note: 'Widget appearance and quick prompts saved. No external script or image URL accepted.'}); }
        if (u.includes('/api/support')) return json(r, {requests: [], cases: [], settings: {label: 'Site help', color: '#233de8', initials: 'AP', prompts: [], allowedOrigins: [], excludedPaths: [], autoOpen: false, side: 'right', hideSources: false, hideOrder: false, hideContact: false}});
        return json(r, {});
      });
      await p.goto(BASE + '/support');
      const panel = p.getByRole('region', {name: 'Working hours'});
      await panel.waitFor();
      await panel.getByLabel('Use working hours for the person handoff').check();
      await panel.getByLabel('Time zone').fill('Asia/Kolkata');
      await panel.getByRole('group', {name: 'Saturday hours'}).getByRole('checkbox').check();
      await panel.getByLabel('Saturday opens').fill('10:00');
      await panel.getByLabel('Saturday closes').fill('14:00');
      await panel.getByLabel('Away message').fill(AWAY);
      await panel.getByLabel('Let visitors choose AI or a person').uncheck();
      await p.getByRole('button', {name: 'Save widget settings'}).click();
      await p.getByText('Widget appearance and quick prompts saved.', {exact: false}).waitFor();
      assert.equal(saved.action, 'settings'); ok();
      assert.equal(saved.settings.workingHours.enabled, true); assert.equal(saved.settings.workingHours.timezone, 'Asia/Kolkata'); assert.equal(saved.settings.workingHours.awayMessage, AWAY); ok();
      assert.deepEqual(saved.settings.workingHours.days.find((d) => d.day === 6), {day: 6, start: '10:00', end: '14:00'}); ok();
      assert.equal(saved.settings.workingHours.days.length, 6, 'Mon-Fri default plus Saturday'); ok();
      assert.equal(saved.settings.visitorChoice, false); ok();
      await noOverflow(p, `support ${vp.width}`);
      assert.deepEqual(errors, [], `page/console errors at ${vp.width}: ${errors.join(' | ')}`); ok();
      await p.screenshot({path: `/tmp/ap-downloads/support-essentials-${vp.width}.png`, fullPage: true}).catch(() => {});
      await p.close();
    }
  } finally { await b.close(); }
  console.log(`PASS verify-support-essentials-ui: ${n} checks (WebKit 390 + 820 + 1440: polled owner message + visitor_message reply, chooser closed = away message + follow-up path, open = joined note, chooser off, owner inbox participants + AI paused + composer only when taken over + reply post + pin menu, /support working hours saved, no overflow, no console errors)`);
} finally { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); }
