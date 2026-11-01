// Per-provider contract tests, hermetic: every adapter request goes to a local mock that validates
// it against the provider's vendored contract (fixtures/billing-specs/<provider>), and every fixture
// and parsed response body is validated against the same contract.
// Usage: npx tsx scripts/verify-billing-contract.ts <provider|all>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadProviderContract} from './billing-contract/contract-digest';
import {hasOperation, matchOperation, validateRequest, validateResponse, declaredServers, serverBasePath, SPEC_ROOT, type Subset} from './billing-contract/openapi';
import {startMock, validateFixtures, loadOperations} from './billing-contract/mock-server';
import type {Scenario} from './billing-contract/scenario';
import {PROVIDERS, enabledProviderIds, providerDefinition} from '../lib/billing/core/registry';
import {guardedRequest, resolveBaseUrl} from '../lib/billing/core/http';
import {resetAllBreakers} from '../lib/billing/core/breaker';
import {composeBillingAnswer, unsupportedSentence} from '../lib/billing/core/answer';
import {filterScoped} from '../lib/billing/core/scope';
import {matchReference} from '../lib/billing/core/verify';
import {BillingError, BILLING_INTENTS, type AdapterDeps, type BillingIntent, type ProviderDefinition} from '../lib/billing/core/types';

const arg = process.argv[2];
if (!arg) { console.error('Usage: npx tsx scripts/verify-billing-contract.ts <provider|all>'); process.exit(2); }
const withFixtures = fs.readdirSync(SPEC_ROOT).filter((p) => fs.existsSync(path.join(SPEC_ROOT, p, 'responses')));
const targets = arg === 'all' ? [...new Set([...enabledProviderIds(), ...withFixtures])] : [arg];

export function derivedCapabilities(def: ProviderDefinition, subset: ReturnType<typeof loadProviderContract>['subset']): Record<BillingIntent, boolean> {
  const byId = new Map(def.operations.map((o) => [o.id, o]));
  return Object.fromEntries(BILLING_INTENTS.map((intent) => {
    const ops = def.capabilities[intent].operations;
    const ok = ops.length > 0 && ops.every((id) => { const o = byId.get(id); return !!o && (o.authExchange ? true : o.method === 'GET' && hasOperation(subset, 'GET', o.path)); });
    return [intent, ok];
  })) as Record<BillingIntent, boolean>;
}

// Concrete URL path for an operation template, under the contract's server base path.
function probeUrl(subset: Subset, template: string): string {
  const doc = subset.documents.find((d) => Object.keys(d.paths).includes(template)) ?? subset.documents[0];
  return serverBasePath(doc) + template.replace(/\{[^}]+\}/g, 'X1');
}

async function run(provider: string): Promise<string> {
  const def = providerDefinition(provider);
  assert.ok(def, `${provider}: no adapter module in the registry`);
  const scenario = (await import(`./billing-contract/scenarios/${provider}.ts`)).scenario as Scenario;
  const {subset, kind} = loadProviderContract(provider);
  let checks = 0;
  const ok = () => checks++;

  // 1. One source of truth: the module's allowlist is operations.json, and every entry exists as GET.
  assert.deepEqual(def.operations, loadOperations(provider)); ok();
  for (const op of def.operations) {
    if (op.authExchange) { assert.equal(op.method, 'POST'); assert.ok(op.body, `${op.id}: auth exchange needs a fixed body`); ok(); continue; }
    assert.equal(op.method, 'GET', `${op.id} must be GET`);
    assert.ok(hasOperation(subset, 'GET', op.path), `${op.id}: GET ${op.path} not in the vendored contract`); ok();
  }
  // The validator itself rejects an unauthenticated request with an undeclared query parameter.
  const probe = def.operations.find((o) => o.method === 'GET')!;
  const bad = validateRequest(subset, {method: 'GET', url: 'http://127.0.0.1' + probeUrl(subset, probe.path) + '?zz_undeclared=1', headers: {}});
  assert.ok(!bad.ok && bad.errors.some((e) => /undeclared query/.test(e)) && bad.errors.some((e) => /auth/.test(e)), `${provider}: validator must reject bad requests (${bad.errors.join('; ')})`); ok();
  // 2. Fixtures validate against the contract.
  const fixtureErrors = validateFixtures(provider, subset);
  assert.deepEqual(fixtureErrors, [], `${provider} fixtures:\n${fixtureErrors.join('\n')}`); ok();
  // 3. Capability matrix equals the one derived from the contract.
  const derived = derivedCapabilities(def, subset);
  for (const i of BILLING_INTENTS) { assert.equal(def.capabilities[i].supported, derived[i], `${provider} capability ${i}`); ok(); }

  // 4. Hosts: fixed per mode; live never targets a sandbox host and vice versa.
  assert.equal(resolveBaseUrl(def, 'test', {config: scenario.config}), scenario.hosts.test); ok();
  assert.equal(resolveBaseUrl(def, 'live', {config: scenario.liveConfig ?? scenario.config}), scenario.hosts.live); ok();
  if (!scenario.sameHost) {
    assert.notEqual(new URL(scenario.hosts.test).host, new URL(scenario.hosts.live).host); ok();
    assert.ok(!/sandbox|test/i.test(new URL(scenario.hosts.live).host), 'live host is not a sandbox host'); ok();
  }
  // When the contract declares concrete servers, both mode hosts must be among them.
  const servers = declaredServers(subset).filter((u) => /^https:\/\//.test(u));
  if (servers.length && !servers.some((u) => u.includes('{'))) {
    const hosts = servers.map((u) => new URL(u).host);
    for (const h of [scenario.hosts.test, scenario.hosts.live].map((u) => new URL(u).host).filter((h) => !scenario.hostsNotInSpec?.includes(h))) { assert.ok(hosts.includes(h), `${provider}: host ${h} not declared in contract servers (${hosts.join(', ')})`); ok(); }
  }

  // 5. Exercise the adapter against the mock.
  resetAllBreakers();
  const mock = await startMock(provider);
  const parsedErrors: string[] = [];
  let fetches = 0;
  const deps = (connectionId: string): AdapterDeps => ({
    fetch: async (u, init) => {
      fetches++;
      const res = await fetch(u, init);
      const url = new URL(u);
      const m = matchOperation(subset, String(init.method ?? 'GET'), url.pathname);
      if (m && res.ok) {
        const body = await res.clone().json().catch(() => undefined);
        for (const e of validateResponse(subset, String(init.method ?? 'GET'), m.template, res.status, body)) parsedErrors.push(`${url.pathname}: ${e}`);
      }
      return res;
    },
    now: () => Date.parse('2026-10-31T12:00:00Z'),
    sleep: async () => undefined,
    connectionId,
    baseUrlOverride: mock.baseUrl,
    config: scenario.config,
  });
  let conn = 0;
  const adapter = () => def.createAdapter(scenario.cred, 'test', deps(`${provider}-${++conn}`));
  try {
    assert.equal((await adapter().testConnection()).ok, true); ok();
    for (const v of scenario.verify) {
      const ref = matchReference(def, v.ref);
      assert.ok(ref || v.expect === 'not_found', `${provider}: reference ${v.ref} matches no pattern`);
      if (!ref) { ok(); continue; }
      const r = await adapter().verifyCustomer(ref.value, v.email);
      assert.equal(r.status, v.expect, `${provider} verify ${v.ref} as ${v.email}`);
      if (r.status === 'verified') {
        if (v.scopeIds) assert.deepEqual(r.scope.recordIds, v.scopeIds);
        if (v.customerId !== undefined) assert.equal(r.scope.customerId, v.customerId);
        assert.equal(r.scope.provider, provider); assert.equal(r.scope.mode, 'test');
        assert.ok(!JSON.stringify(r.scope).includes('@'), 'scope never holds an email');
      }
      ok();
    }
    const exercised = new Set<BillingIntent>();
    for (const l of scenario.lookups) {
      const ref = matchReference(def, l.ref)!;
      const v = await adapter().verifyCustomer(ref.value, l.email);
      assert.equal(v.status, 'verified', `${provider} lookup setup ${l.ref}`);
      if (v.status !== 'verified') continue;
      const records = filterScoped(v.scope, await adapter().lookup(v.scope, l.intent));
      l.expect(records);
      for (const r of records) { assert.equal(r.provider, provider); assert.equal(r.mode, 'test'); assert.ok(Number.isSafeInteger(r.amountMinor ?? 0)); }
      const answer = composeBillingAnswer(def, l.intent, records, 'test');
      assert.ok(answer.answer.endsWith('Read-only Test mode record. No money moved.'));
      if (l.intent === 'refund_status') assert.ok(answer.answer.includes('No refund has been issued by this assistant.'));
      assert.equal(answer.sources.length, Math.min(records.length, 5));
      assert.ok(answer.sources.every((s) => s.sourceKind === 'billing_record'));
      assert.ok(answer.cards.every((c) => !('customerRef' in c)));
      exercised.add(l.intent);
      ok();
    }
    for (const i of BILLING_INTENTS) {
      if (def.capabilities[i].supported) { assert.ok(exercised.has(i), `${provider}: supported intent ${i} has no lookup test`); ok(); }
      else { assert.ok(composeBillingAnswer(def, i, [], 'test').answer.startsWith(unsupportedSentence(def.label))); ok(); }
    }
    assert.deepEqual(mock.violations, [], `${provider} request violations:\n${mock.violations.join('\n')}`); ok();
    assert.deepEqual(parsedErrors, [], `${provider} parsed body errors:\n${parsedErrors.join('\n')}`); ok();
    assert.ok(mock.requests.length > 0 && mock.requests.every((r) => r.ok)); ok();
    assert.ok(mock.requests.every((r) => r.method === 'GET' || def.operations.some((o) => o.authExchange && o.method === r.method && r.url.startsWith(o.path))), 'only GET and the named auth exchange were sent'); ok();

    // 6. Mixed-customer responses are filtered out by scope.
    if (scenario.mixed) {
      const ref = matchReference(def, scenario.mixed.ref)!;
      const v = await adapter().verifyCustomer(ref.value, scenario.mixed.email);
      assert.equal(v.status, 'verified');
      if (v.status === 'verified') {
        mock.setMode('mixed_customers');
        const records = filterScoped(v.scope, await adapter().lookup(v.scope, scenario.mixed.intent));
        for (const r of records) assert.ok(!scenario.mixed.forbiddenIds.includes(r.id), `mixed: leaked ${r.id}`);
        const mark = mock.requests.length;
        const again = await adapter().verifyCustomer(ref.value, scenario.mixed.email);
        // When the provider answers the verification read with another record, it never verifies.
        if (scenario.mixed.verifyRejected) { assert.ok(mock.requests.slice(mark).some((q) => q.modeFixture)); assert.notEqual(again.status, 'verified', 'mixed: a response for another record never verifies'); }
        mock.setMode('normal');
        ok();
      }
    }
    // 7. Provider refusing the key maps to auth_failed; never leaks the body.
    mock.setMode('unauthorized');
    await assert.rejects(() => adapter().testConnection(), (e: unknown) => e instanceof BillingError && e.code === 'auth_failed'); ok();
    mock.setMode('normal');
    if (scenario.modeMismatch) {
      const a = def.createAdapter(scenario.modeMismatch.cred, scenario.modeMismatch.mode, {...deps(`${provider}-mm`), config: scenario.modeMismatch.config ?? scenario.config});
      await assert.rejects(() => a.testConnection(), (e: unknown) => e instanceof BillingError && e.code === 'mode_mismatch'); ok();
    }

    if (scenario.extra) { checks += await scenario.extra({mock, adapter}); mock.setMode('normal'); }
    // 8. Writes never leave the process.
    const before = fetches;
    await assert.rejects(() => guardedRequest({definition: def, mode: 'test', baseUrl: mock.baseUrl, op: {method: scenario.writeProbe.method, path: scenario.writeProbe.path, body: scenario.writeProbe.body}, auth: {Authorization: 'Bearer fictional'}, connectionId: `${provider}-write`, deps: deps(`${provider}-write`)}), (e: unknown) => e instanceof BillingError && e.code === 'write_blocked');
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const p = def.operations.find((o) => o.method === 'GET')!.path.replace(/\{[^}]+\}/g, 'X1');
      await assert.rejects(() => guardedRequest({definition: def, mode: 'test', baseUrl: mock.baseUrl, op: {method, path: p}, auth: {}, connectionId: `${provider}-write`, deps: deps(`${provider}-write`)}), (e: unknown) => e instanceof BillingError && e.code === 'write_blocked');
    }
    assert.equal(fetches, before, 'blocked writes made no request'); ok();
  } finally {
    await mock.close();
  }

  // 9. Credential rules per mode.
  for (const r of scenario.credentialRules) {
    const res = def.validateCredential(r.mode, r.cred, r.config);
    assert.equal(res.ok, r.ok, `${provider} credential rule ${r.mode} ${JSON.stringify(Object.keys(r.cred))} expected ${r.ok}`);
    if (!res.ok && r.code) assert.equal(res.code, r.code);
    if (!res.ok && r.message) assert.match(res.message, r.message);
    if (res.ok) assert.ok(!Object.values(r.cred).some((v) => v.length > 12 && res.keyHint.includes(v)), 'key hint never contains the full secret');
    ok();
  }
  const matrix = BILLING_INTENTS.map((i) => `${i}:${def.capabilities[i].supported ? 'yes' : 'no'}`).join(' ');
  return `PASS ${provider} (${def.source.confidence}, ${kind}): ${checks} checks, ${mock.requests.length} mock requests validated, 0 violations | ${matrix}`;
}

async function main() {
  let failed = 0;
  for (const p of targets) {
    try { console.log(await run(p)); }
    catch (e) { failed++; console.error(`FAIL ${p}: ${(e as Error).message}`); }
  }
  const enabled = Object.entries(PROVIDERS).filter(([, e]) => e?.enabled).map(([id]) => id);
  console.log(`Registry enabled: ${enabled.join(', ') || 'none'}`);
  if (failed) process.exit(1);
}
main();
