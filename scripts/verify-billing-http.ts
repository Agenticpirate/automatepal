// guardedRequest: read-only allowlist, retry, 429/Retry-After, breaker, token bucket, timeout,
// size cap, redirects, base URL override rules, and the scoped lookup cache.
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {guardedRequest, resolveBaseUrl, allowlisted} from '../lib/billing/core/http';
import {resetAllBreakers, breakerState} from '../lib/billing/core/breaker';
import {cacheGet, cacheSet, invalidateConnection, clearCache} from '../lib/billing/core/cache';
import {BillingError, type AdapterDeps, type ProviderDefinition, type BillingRecord} from '../lib/billing/core/types';

type Plan = {status: number; headers?: Record<string, string>; body?: string; delayMs?: number; destroy?: boolean};
let queue: Plan[] = [];
const server = http.createServer((req, res) => {
  const p = queue.shift() ?? {status: 200, body: '{"ok":true}'};
  const go = () => {
    if (p.destroy) { req.socket.destroy(); return; }
    res.writeHead(p.status, {'content-type': 'application/json', ...(p.headers ?? {})});
    res.end(p.body ?? '{"ok":true}');
  };
  if (p.delayMs) setTimeout(go, p.delayMs); else go();
});

const def = {
  id: 'paypal', label: 'Test', tier: 'A', source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://api.example.test'}, live: {baseUrl: 'https://api.example.test'}},
  credentialFields: [], validateCredential: () => ({ok: true, keyHint: ''}),
  operations: [
    {id: 'things.get', method: 'GET', path: '/v1/things/{id}', query: []},
    {id: 'things.list', method: 'GET', path: '/v1/things', query: ['limit']},
    {id: 'token', method: 'POST', path: '/v1/token', query: [], authExchange: true, body: 'grant_type=client_credentials'},
  ],
  capabilities: {} as ProviderDefinition['capabilities'], referencePatterns: [], hostedHosts: {test: [], live: []},
  createAdapter: () => { throw Error('unused'); },
} as unknown as ProviderDefinition;

let clock = 1_000_000;
const sleeps: number[] = [];
let calls = 0;
let n = 0;
const ok = () => n++;
function deps(connectionId: string, extra: Partial<AdapterDeps> = {}): AdapterDeps {
  return {
    fetch: (u, i) => { calls++; return fetch(u, i); },
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    connectionId,
    random: () => 0.5,
    ...extra,
  };
}
async function code(p: Promise<unknown>): Promise<string> {
  try { await p; return 'ok'; } catch (e) { return e instanceof BillingError ? e.code : 'other:' + (e as Error).message; }
}

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req = (conn: string, op: {method: string; path: string; query?: Record<string, string>; body?: string}, extra: Partial<AdapterDeps> = {}) =>
    guardedRequest({definition: def, mode: 'test', baseUrl: base, op, auth: {Authorization: 'Bearer fictional-token-0000'}, connectionId: conn, deps: deps(conn, extra)});

  // 1. Allowlist: anything outside the GET list (or the exact auth exchange) never reaches fetch.
  calls = 0;
  for (const op of [
    {method: 'GET', path: '/v1/other'},
    {method: 'POST', path: '/v1/things/abc'},
    {method: 'PUT', path: '/v1/things/abc'},
    {method: 'PATCH', path: '/v1/things/abc'},
    {method: 'DELETE', path: '/v1/things/abc'},
    {method: 'GET', path: '/v1/things', query: {limit: '1', expand: 'all'}},
    {method: 'GET', path: '/v1/things/abc', body: '{}'},
    {method: 'POST', path: '/v1/token', body: 'grant_type=client_credentials&scope=write'},
    {method: 'POST', path: '/v1/things', body: 'grant_type=client_credentials'},
    {method: 'GET', path: '/v1/things/..'},
    {method: 'GET', path: '/v1/things/%2e%2e'},
    {method: 'GET', path: '/v1/things/a%2Fb'},
    {method: 'GET', path: '/v1/things/abc/refund'},
  ]) { assert.equal(await code(req('allow', op)), 'write_blocked', `${op.method} ${op.path}`); ok(); }
  assert.equal(calls, 0, 'fetch never called for blocked requests'); ok();
  assert.ok(allowlisted(def, {method: 'POST', path: '/v1/token', body: 'grant_type=client_credentials'})); ok();
  assert.ok(allowlisted(def, {method: 'GET', path: '/v1/things', query: {limit: '1'}})); ok();

  // 2. 5xx once is retried with 250-750 ms jitter and succeeds; twice gives provider_error after 2 calls.
  calls = 0; sleeps.length = 0; queue = [{status: 503}, {status: 200, body: '{"id":"x"}'}];
  const r = await req('retry1', {method: 'GET', path: '/v1/things/x'});
  assert.deepEqual(r.data, {id: 'x'}); assert.equal(calls, 2); assert.equal(sleeps.length, 1); assert.ok(sleeps[0] >= 250 && sleeps[0] <= 750); ok();
  calls = 0; queue = [{status: 500}, {status: 502}];
  assert.equal(await code(req('retry2', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); assert.equal(calls, 2); ok();
  // 4xx are not retried.
  calls = 0; queue = [{status: 400}];
  assert.equal(await code(req('c4xx', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); assert.equal(calls, 1); ok();
  calls = 0; queue = [{status: 404}];
  assert.equal(await code(req('c404', {method: 'GET', path: '/v1/things/x'})), 'not_found'); assert.equal(calls, 1); ok();
  calls = 0; queue = [{status: 401}];
  assert.equal(await code(req('c401', {method: 'GET', path: '/v1/things/x'})), 'auth_failed'); assert.equal(calls, 1); ok();
  // Network error is retried once.
  calls = 0; queue = [{status: 0, destroy: true}, {status: 200}];
  assert.equal(await code(req('net1', {method: 'GET', path: '/v1/things/x'})), 'ok'); assert.equal(calls, 2); ok();
  calls = 0; queue = [{status: 0, destroy: true}, {status: 0, destroy: true}];
  assert.equal(await code(req('net2', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); assert.equal(calls, 2); ok();

  // 3. 429: short Retry-After waits and retries once; long Retry-After sets a cooldown that refuses without fetch.
  calls = 0; sleeps.length = 0; queue = [{status: 429, headers: {'retry-after': '1'}}, {status: 200}];
  assert.equal(await code(req('r429a', {method: 'GET', path: '/v1/things/x'})), 'ok'); assert.equal(calls, 2); assert.deepEqual(sleeps, [1000]); ok();
  calls = 0; queue = [{status: 429, headers: {'retry-after': '120'}}];
  assert.equal(await code(req('r429b', {method: 'GET', path: '/v1/things/x'})), 'rate_limited'); assert.equal(calls, 1); ok();
  assert.equal(await code(req('r429b', {method: 'GET', path: '/v1/things/x'})), 'rate_limited'); assert.equal(calls, 1, 'cooldown refuses without fetch'); ok();
  clock += 121_000;
  assert.equal(await code(req('r429b', {method: 'GET', path: '/v1/things/x'})), 'ok'); assert.equal(calls, 2); ok();
  calls = 0; sleeps.length = 0; queue = [{status: 429, headers: {'retry-after': new Date(clock + 600_000).toUTCString()}}];
  assert.equal(await code(req('r429c', {method: 'GET', path: '/v1/things/x'})), 'rate_limited'); assert.equal(sleeps.length, 0, 'HTTP-date Retry-After honoured'); ok();
  calls = 0; queue = [{status: 429, headers: {'retry-after': '1'}}, {status: 429, headers: {'retry-after': '1'}}];
  assert.equal(await code(req('r429d', {method: 'GET', path: '/v1/things/x'})), 'rate_limited'); assert.equal(calls, 2, 'only one 429 retry'); ok();

  // 4. Breaker: 5 consecutive failures open it for 60 s, then one half-open probe.
  resetAllBreakers(); calls = 0;
  for (let i = 0; i < 5; i++) { queue.push({status: 500}, {status: 500}); assert.equal(await code(req('brk', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); clock += 1000; }
  assert.equal(calls, 10); ok();
  assert.equal(await code(req('brk', {method: 'GET', path: '/v1/things/x'})), 'circuit_open'); assert.equal(calls, 10, 'open breaker refuses without fetch'); ok();
  assert.equal(breakerState('brk', clock), 'open'); ok();
  clock += 60_000;
  assert.equal(breakerState('brk', clock), 'half_open'); ok();
  queue = [{status: 500}, {status: 500}];
  assert.equal(await code(req('brk', {method: 'GET', path: '/v1/things/x'})), 'provider_error', 'probe went out'); assert.equal(calls, 12); ok();
  assert.equal(await code(req('brk', {method: 'GET', path: '/v1/things/x'})), 'circuit_open', 'failed probe reopens'); ok();
  clock += 60_001; queue = [{status: 200}];
  assert.equal(await code(req('brk', {method: 'GET', path: '/v1/things/x'})), 'ok'); assert.equal(breakerState('brk', clock), 'closed'); ok();

  // 5. Token bucket: 10 per 10 s per connection.
  calls = 0;
  for (let i = 0; i < 10; i++) assert.equal(await code(req('bucket', {method: 'GET', path: '/v1/things/x'})), 'ok');
  assert.equal(await code(req('bucket', {method: 'GET', path: '/v1/things/x'})), 'rate_limited'); assert.equal(calls, 10); ok();
  clock += 1000;
  assert.equal(await code(req('bucket', {method: 'GET', path: '/v1/things/x'})), 'ok'); ok();

  // 6. Timeout, huge body, redirects, invalid JSON.
  queue = [{status: 200, delayMs: 400}];
  assert.equal(await code(req('slow', {method: 'GET', path: '/v1/things/x'}, {timeoutMs: 100})), 'timeout'); ok();
  queue = [{status: 200, body: JSON.stringify({pad: 'x'.repeat(1024 * 1024 + 10)})}];
  assert.equal(await code(req('huge', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); ok();
  calls = 0; queue = [{status: 302, headers: {location: 'https://evil.example.test/'}}, {status: 302, headers: {location: 'https://evil.example.test/'}}];
  assert.equal(await code(req('redir', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); ok();
  queue = [{status: 200, body: 'not json'}];
  assert.equal(await code(req('badjson', {method: 'GET', path: '/v1/things/x'})), 'provider_error'); ok();
  await new Promise((r) => setTimeout(r, 450));
  queue = [];

  // 7. Base URL override only for 127.0.0.1 outside production.
  assert.equal(resolveBaseUrl(def, 'test', {baseUrlOverride: base}), base); ok();
  assert.throws(() => resolveBaseUrl(def, 'test', {baseUrlOverride: 'http://localhost:9'}), BillingError); ok();
  assert.throws(() => resolveBaseUrl(def, 'test', {baseUrlOverride: 'https://evil.example.test'}), BillingError); ok();
  const env = process.env as Record<string, string | undefined>;
  const prev = env.NODE_ENV; env.NODE_ENV = 'production';
  assert.throws(() => resolveBaseUrl(def, 'test', {baseUrlOverride: base}), BillingError); ok();
  env.NODE_ENV = prev;
  assert.equal(resolveBaseUrl(def, 'test', {}), 'https://api.example.test'); ok();

  // 8. Cache: scoped to connection + verification + intent; 60 s TTL; cleared on invalidate.
  clearCache();
  const rec = {id: 'A'} as BillingRecord;
  cacheSet('conn1', 'verA', 'order_status', [rec], clock);
  assert.deepEqual(cacheGet('conn1', 'verA', 'order_status', clock + 1000), [rec]); ok();
  assert.equal(cacheGet('conn1', 'verB', 'order_status', clock + 1000), null, 'another verification misses'); ok();
  assert.equal(cacheGet('conn1', 'verA', 'invoice', clock + 1000), null, 'another intent misses'); ok();
  assert.equal(cacheGet('conn2', 'verA', 'order_status', clock + 1000), null, 'another connection misses'); ok();
  assert.equal(cacheGet('conn1', 'verA', 'order_status', clock + 60_000), null, 'expires after 60 s'); ok();
  cacheSet('conn1', 'verA', 'order_status', [rec], clock);
  cacheSet('conn3', 'verC', 'order_status', [rec], clock);
  invalidateConnection('conn1');
  assert.equal(cacheGet('conn1', 'verA', 'order_status', clock), null); assert.deepEqual(cacheGet('conn3', 'verC', 'order_status', clock), [rec]); ok();
  for (let i = 0; i < 600; i++) cacheSet('fill', 'v' + i, 'order_status', [rec], clock);
  assert.equal(cacheGet('fill', 'v0', 'order_status', clock), null, 'LRU bounded to 500'); ok();

  console.log(`PASS verify-billing-http: ${n} checks (allowlist blocks writes with 0 fetches, 5xx/network retry once, 4xx no retry, 429 Retry-After + cooldown, breaker open/half-open, token bucket, timeout, size cap, redirects refused, override rules, scoped cache)`);
}
main().then(() => server.close()).catch((e) => { console.error(e); server.close(); process.exit(1); });
