// End-to-end Team check against a LOCAL Supabase + a local `next start` build.
// Creates synthetic local users, signs them in with real tokens, and exercises /api/team plus
// role enforcement on existing APIs. Local only: refuses non-local Supabase URLs.
// Usage: API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... BASE=http://localhost:3280 node scripts/verify-team-api.mjs
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
const {API_URL, ANON_KEY, SERVICE_ROLE_KEY} = process.env;
const BASE = process.env.BASE || 'http://localhost:3280';
if (!API_URL || !['127.0.0.1', 'localhost'].includes(new URL(API_URL).hostname)) throw Error('API_URL must be the local Supabase');
const admin = createClient(API_URL, SERVICE_ROLE_KEY, {auth: {persistSession: false}});
let n = 0; const ok = (label) => { n++; if (process.env.VERBOSE) console.log('ok', label); };
const run = randomUUID().slice(0, 8);
async function user(name) {
  const email = `${name}.${run}@team.example.test`, password = 'Local-only-' + randomUUID();
  const c = await admin.auth.admin.createUser({email, password, email_confirm: true});
  if (c.error) throw c.error;
  const s = await createClient(API_URL, ANON_KEY, {auth: {persistSession: false}}).auth.signInWithPassword({email, password});
  if (s.error) throw s.error;
  return {id: c.data.user.id, email, token: s.data.session.access_token};
}
const call = async (u, path, {method = 'GET', body, ws} = {}) => {
  const headers = {Authorization: `Bearer ${u.token}`};
  if (ws) headers['x-workspace-id'] = ws;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, {method, headers, body: body ? JSON.stringify(body) : undefined});
  return {status: r.status, json: await r.json().catch(() => ({}))};
};
const owner = await user('owner'), agent = await user('agent'), manager = await user('manager'), outsider = await user('outsider');
try {
  // Owner sees a one-person team.
  let r = await call(owner, '/api/team');
  assert.equal(r.status, 200); assert.equal(r.json.current.role, 'owner'); assert.equal(r.json.team.length, 1); ok('owner team');
  // Owner invites; link carries the token in the fragment only.
  r = await call(owner, '/api/team', {method: 'POST', body: {action: 'invite', email: agent.email.toUpperCase(), role: 'agent'}});
  assert.equal(r.status, 200, JSON.stringify(r.json)); const agentLink = new URL(r.json.link);
  assert.equal(agentLink.pathname, '/invite'); assert.equal(agentLink.search, ''); assert.match(agentLink.hash, /^#ap_inv_[a-f0-9]{64}$/); ok('invite link');
  r = await call(owner, '/api/team', {method: 'POST', body: {action: 'invite', email: manager.email, role: 'manager'}});
  const managerToken = new URL(r.json.link).hash.slice(1);
  r = await call(owner, '/api/team', {method: 'POST', body: {action: 'invite', email: agent.email, role: 'agent'}});
  assert.equal(r.json.error, 'Invite already pending'); ok('duplicate invite refused');
  // Wrong person cannot accept.
  r = await call(outsider, '/api/team', {method: 'POST', body: {action: 'accept', token: agentLink.hash.slice(1)}});
  assert.equal(r.json.error, 'Invite unavailable'); ok('email-bound acceptance');
  r = await call(agent, '/api/team', {method: 'POST', body: {action: 'accept', token: agentLink.hash.slice(1)}});
  assert.equal(r.json.workspace, owner.id); ok('agent accepted');
  r = await call(manager, '/api/team', {method: 'POST', body: {action: 'accept', token: managerToken}});
  assert.equal(r.json.workspace, owner.id); ok('manager accepted');
  // Agent acting in the owner's workspace.
  r = await call(agent, '/api/team', {ws: owner.id});
  assert.equal(r.json.current.role, 'agent'); assert.equal(r.json.team.length, 3); assert.deepEqual(r.json.invites, []); ok('agent context');
  r = await call(agent, '/api/tickets', {ws: owner.id}); assert.equal(r.status, 200, JSON.stringify(r.json)); ok('agent reads tickets');
  r = await call(agent, '/api/team', {method: 'POST', ws: owner.id, body: {action: 'invite', email: `x.${run}@team.example.test`, role: 'agent'}});
  assert.equal(r.json.error, 'Insufficient role'); ok('agent cannot invite');
  r = await call(agent, '/api/integrations', {method: 'POST', ws: owner.id, body: {label: 'agent', scope: 'support:read', hours: 1, consent: true}});
  assert.equal(r.status, 400); ok('agent cannot create API tokens');
  r = await call(agent, '/api/integrations', {ws: owner.id}); assert.deepEqual(r.json.tokens, []); ok('agent sees no tokens');
  // Manager can invite agents, not managers.
  r = await call(manager, '/api/team', {method: 'POST', ws: owner.id, body: {action: 'invite', email: `m.${run}@team.example.test`, role: 'manager'}});
  assert.equal(r.json.error, 'Insufficient role'); ok('manager cannot invite managers');
  r = await call(manager, '/api/team', {method: 'POST', ws: owner.id, body: {action: 'invite', email: `a.${run}@team.example.test`, role: 'agent'}});
  assert.ok(r.json.link); ok('manager invites agent');
  r = await call(manager, '/api/team', {ws: owner.id}); assert.equal(r.json.invites.length, 1); ok('manager sees invites');
  // Outsider cannot act in the workspace; a forged header fails closed.
  r = await call(outsider, '/api/tickets', {ws: owner.id}); assert.equal(r.status, 401); ok('outsider header denied');
  r = await call(outsider, '/api/team', {ws: owner.id}); assert.equal(r.json.workspaceInvalid, true); assert.equal(r.json.current, null); ok('outsider workspace invalid');
  r = await call(agent, '/api/tickets', {ws: 'not-a-uuid'}); assert.equal(r.status, 401); ok('malformed header denied');
  // Owner promotes and removes; removed agent loses access.
  r = await call(owner, '/api/team', {method: 'POST', body: {action: 'set_role', user: agent.id, role: 'manager'}});
  assert.equal(r.json.note, 'Role updated.'); ok('owner promotes');
  r = await call(owner, '/api/team', {method: 'POST', body: {action: 'remove', user: agent.id}});
  assert.match(r.json.note, /Member removed/); ok('owner removes');
  r = await call(agent, '/api/tickets', {ws: owner.id}); assert.equal(r.status, 401); ok('removed member denied');
  // Manager leaves.
  r = await call(manager, '/api/team', {method: 'POST', body: {action: 'leave', workspace: owner.id}});
  assert.equal(r.json.note, 'You left the workspace.'); ok('manager leaves');
  r = await call(owner, '/api/team'); assert.equal(r.json.team.length, 1); ok('team back to one');
  // Owner's own APIs are unaffected without a header.
  r = await call(owner, '/api/integrations'); assert.equal(r.status, 200); ok('owner path unchanged');
  console.log(`PASS team API: ${n} checks; real local sign-ins, fragment-only invite link, email-bound accept, agent/manager limits on /api/team, /api/integrations and /api/tickets, forged and malformed headers denied, promote/remove/leave.`);
} finally {
  for (const u of [owner, agent, manager, outsider]) await admin.auth.admin.deleteUser(u.id);
}
