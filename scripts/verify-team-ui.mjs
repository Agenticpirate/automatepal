// Team UI check against a LOCAL Supabase + local `next start`. Real sessions are injected into the
// browser the same way supabase-js stores them. Screenshots go to $SHOTS (default /tmp/ap-team-ui).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from '@playwright/test';
const {API_URL, ANON_KEY, SERVICE_ROLE_KEY} = process.env;
const BASE = process.env.BASE || 'http://localhost:3281';
const SHOTS = process.env.SHOTS || '/tmp/ap-team-ui';
if (!API_URL || !['127.0.0.1', 'localhost'].includes(new URL(API_URL).hostname)) throw Error('API_URL must be the local Supabase');
fs.mkdirSync(SHOTS, {recursive: true});
const admin = createClient(API_URL, SERVICE_ROLE_KEY, {auth: {persistSession: false}});
const storageKey = `sb-${new URL(API_URL).hostname.split('.')[0]}-auth-token`;
const run = randomUUID().slice(0, 6);
const users = [];
async function user(name) {
  const email = `${name}.${run}@north-dock.example.test`, password = 'Local-only-' + randomUUID();
  const c = await admin.auth.admin.createUser({email, password, email_confirm: true}); if (c.error) throw c.error;
  const s = await createClient(API_URL, ANON_KEY, {auth: {persistSession: false}}).auth.signInWithPassword({email, password}); if (s.error) throw s.error;
  const u = {id: c.data.user.id, email, session: s.data.session}; users.push(u); return u;
}
const api = (u, body, ws) => fetch(BASE + '/api/team', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${u.session.access_token}`, ...(ws ? {'x-workspace-id': ws} : {})}, body: JSON.stringify(body)}).then(r => r.json());
let n = 0; const ok = () => n++;
// Asserts no horizontal page overflow; on failure lists the widest offenders (scroll containers excluded).
async function noOverflow(p, label) {
  const r = await p.evaluate(() => {
    const W = innerWidth, wide = [];
    for (const el of document.querySelectorAll('body *')) { if (el.closest('.ap-dash-mobilenav')) continue; const b = el.getBoundingClientRect(); if (b.right > W + 1) wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(b.right)}`); }
    return {ok: document.body.scrollWidth <= W, wide: wide.slice(0, 8)};
  });
  assert.ok(r.ok, `${label} overflows: ${r.wide.join(' | ')}`); ok();
}
const b = await chromium.launch({channel: 'chrome'});
async function pageAs(u, ws, vp = {width: 1440, height: 1000}) {
  const ctx = await b.newContext({viewport: vp, reducedMotion: 'reduce'});
  // Seed once per tab, so later navigations keep whatever the app itself stores.
  await ctx.addInitScript(([k, v, w]) => { if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1'); localStorage.setItem(k, v); if (w) localStorage.setItem('ap-workspace', w); else localStorage.removeItem('ap-workspace'); }, [storageKey, JSON.stringify(u.session), ws ?? '']);
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message)); p.errors = errors; return p;
}
try {
  const owner = await user('owner'), adm = await user('priya'), agent = await user('meera'), invitee = await user('kiran');
  for (const [u, role] of [[adm, 'admin'], [agent, 'agent']]) {
    const inv = await api(owner, {action: 'invite', email: u.email, role});
    const acc = await api(u, {action: 'accept', token: new URL(inv.link).hash.slice(1)}); assert.equal(acc.workspace, owner.id);
  }
  await api(owner, {action: 'invite', email: `pending.${run}@north-dock.example.test`, role: 'manager'});

  // Owner view.
  let p = await pageAs(owner);
  await p.goto(BASE + '/team', {waitUntil: 'networkidle'});
  await p.getByRole('heading', {name: 'Members', level: 2}).waitFor();
  assert.equal(await p.locator('.tm-member').count(), 3); ok();
  assert.equal(await p.locator('.tm-invite').count(), 1); ok();
  assert.ok(await p.getByRole('button', {name: /^Admin/}).isEnabled()); ok();
  await p.getByLabel('Work email').fill(invitee.email);
  await p.getByRole('button', {name: /^Agent/}).click();
  await p.getByRole('button', {name: 'Create invite link'}).click();
  const code = p.locator('.tm-link code'); await code.waitFor();
  const link = await code.textContent(); assert.match(link, /\/invite#ap_inv_[a-f0-9]{64}$/); ok();
  await p.locator('.tm-invite').nth(1).waitFor(); ok();
  await noOverflow(p, 'owner desktop');
  await p.screenshot({path: `${SHOTS}/team-owner-desktop.png`, fullPage: true});
  await p.setViewportSize({width: 390, height: 844});
  await p.waitForTimeout(150);
  await noOverflow(p, 'owner mobile');
  await p.screenshot({path: `${SHOTS}/team-owner-mobile.png`, fullPage: true});
  assert.deepEqual(p.errors, []); await p.context().close();

  // Invitee accepts through the real invite page.
  p = await pageAs(invitee);
  await p.goto(link, {waitUntil: 'networkidle'});
  await p.getByRole('heading', {name: 'You have been invited'}).waitFor(); ok();
  assert.equal(new URL(p.url()).hash, ''); ok();
  await p.screenshot({path: `${SHOTS}/invite-ready.png`});
  await p.getByRole('button', {name: 'Accept invite'}).click();
  await p.waitForURL(/\/owner$/, {timeout: 15000}); ok();
  assert.equal(await p.evaluate(() => localStorage.getItem('ap-workspace')), owner.id); ok();
  await p.context().close();

  // Agent acting in the owner's workspace: read-only team controls, switcher shown.
  p = await pageAs(agent, owner.id);
  await p.goto(BASE + '/team', {waitUntil: 'networkidle'});
  await p.getByRole('heading', {name: 'Members', level: 2}).waitFor();
  assert.equal(await p.locator('.tm-member').count(), 4); ok();
  assert.equal(await p.locator('.tm-member select').count(), 0); ok();
  assert.equal(await p.getByRole('button', {name: 'Create invite link'}).count(), 0); ok();
  assert.equal(await p.getByRole('heading', {name: 'Pending invites', level: 2}).count(), 0); ok();
  assert.equal(await p.getByRole('heading', {name: 'Pending invites', level: 3}).count(), 0); ok();
  await p.getByRole('heading', {name: 'Your role', level: 3}).waitFor(); ok();
  assert.equal(await p.getByLabel('Switch workspace').inputValue(), owner.id); ok();
  await p.screenshot({path: `${SHOTS}/team-agent-desktop.png`, fullPage: true});
  assert.deepEqual(p.errors, []); await p.context().close();

  // Admin: can change the agent's role, cannot manage the owner.
  p = await pageAs(adm, owner.id);
  await p.goto(BASE + '/team', {waitUntil: 'networkidle'});
  const roleSel = p.getByLabel(`Role for ${agent.email}`); await roleSel.waitFor();
  await roleSel.selectOption('manager');
  await p.getByText('Role updated.').waitFor(); ok();
  assert.equal(await p.getByLabel(`Role for ${owner.email}`).count(), 0); ok();
  assert.ok(await p.getByRole('button', {name: /^Admin/}).isDisabled()); ok();
  await p.screenshot({path: `${SHOTS}/team-admin-desktop.png`, fullPage: true});
  assert.deepEqual(p.errors, []); await p.context().close();

  // Stale workspace selection (after removal) resets to the person's own workspace.
  await api(owner, {action: 'remove', user: agent.id});
  p = await pageAs(agent, owner.id);
  await p.goto(BASE + '/team', {waitUntil: 'networkidle'});
  await p.waitForFunction(() => localStorage.getItem('ap-workspace') === null, null, {timeout: 15000}); ok();
  await p.getByRole('heading', {name: 'Members', level: 2}).waitFor();
  assert.equal(await p.locator('.tm-member').count(), 1); ok();
  await p.context().close();
  console.log(`PASS team UI: ${n} checks; owner invite flow with once-shown link, invite page accept + redirect + workspace switch, agent read-only controls and switcher, admin role change with rank limits, stale workspace reset, no overflow at 1440/390, no page errors. Screenshots in ${SHOTS}.`);
} finally {
  await b.close();
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
