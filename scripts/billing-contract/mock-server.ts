// Local provider mock for hermetic billing tests. node:http on 127.0.0.1:0.
// Routes by the vendored contract's path templates, validates every incoming request against it,
// and serves hand-written fixtures from fixtures/billing-specs/<provider>/responses/*.json.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {SPEC_ROOT, validateRequest, validateResponse, matchOperation, type Subset} from './openapi';
import {loadProviderContract} from './contract-digest';

// Provider scenarios may add their own fixture-tagged modes (e.g. a permission missing on one API).
export type MockMode = 'normal' | 'unauthorized' | 'server_error_once' | 'server_error_always' | 'rate_limited' | 'slow' | 'huge' | 'mixed_customers' | (string & {});
export type Fixture = {name?: string; method: string; path: string; query?: Record<string, string>; status: number; body: unknown; modes?: MockMode[]; contentType?: string; notFound?: boolean};
export type RecordedRequest = {method: string; url: string; headers: Record<string, string>; body: string; ok: boolean; errors: string[]; key?: string; served: number; modeFixture?: boolean};
export type OperationEntry = {id: string; method: string; path: string; query?: string[]; file?: string; authExchange?: boolean; body?: string};

export function loadOperations(provider: string): OperationEntry[] {
  return JSON.parse(fs.readFileSync(path.join(SPEC_ROOT, provider, 'operations.json'), 'utf8')) as OperationEntry[];
}
export function loadFixtures(provider: string): Fixture[] {
  const dir = path.join(SPEC_ROOT, provider, 'responses');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().flatMap((f) => {
    const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Fixture | Fixture[];
    return (Array.isArray(v) ? v : [v]).map((x) => ({...x, name: x.name ?? f}));
  });
}

// Every 2xx fixture body must validate against the vendored contract.
export function validateFixtures(provider: string, subset?: Subset): string[] {
  const s = subset ?? loadProviderContract(provider).subset;
  const ops = loadOperations(provider);
  const errors: string[] = [];
  for (const f of loadFixtures(provider)) {
    if (f.status < 200 || f.status >= 300) continue;
    if (ops.some((o) => o.authExchange && o.method === f.method && o.path === f.path)) continue;
    const match = matchOperation(s, f.method, f.path);
    if (!match) { errors.push(`${f.name}: no operation for ${f.method} ${f.path}`); continue; }
    for (const e of validateResponse(s, f.method, match.template, f.status, f.body)) errors.push(`${f.name}: ${e}`);
  }
  return errors;
}

export async function startMock(provider: string, opts: {mode?: MockMode; slowMs?: number} = {}) {
  const {subset} = loadProviderContract(provider);
  const ops = loadOperations(provider);
  const fixtures = loadFixtures(provider);
  let mode: MockMode = opts.mode ?? 'normal';
  let erroredOnce = false;
  const requests: RecordedRequest[] = [];
  const violations: string[] = [];

  const pick = (method: string, url: URL): Fixture | undefined => {
    const pathname = (() => { try { return decodeURIComponent(url.pathname); } catch { return url.pathname; } })();
    const hits = fixtures.filter((f) => f.method === method && (f.path === url.pathname || f.path === pathname) && Object.entries(f.query ?? {}).every(([k, v]) => url.searchParams.get(k) === v));
    // Prefer more specific query matches, then fixtures tagged for the current mode.
    hits.sort((a, b) => Object.keys(b.query ?? {}).length - Object.keys(a.query ?? {}).length);
    return hits.find((f) => f.modes?.includes(mode)) ?? hits.find((f) => !f.modes);
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = (req.method ?? 'GET').toUpperCase();
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')]));
      const exchange = ops.find((o) => o.authExchange && o.method === method && o.path === url.pathname);
      let result: {ok: boolean; errors: string[]; key?: string};
      if (exchange) {
        const errors: string[] = [];
        if (!/^Basic [A-Za-z0-9+/=]+$/.test(headers.authorization ?? '')) errors.push('auth exchange requires Basic credentials');
        if (exchange.body && body !== exchange.body) errors.push('auth exchange body mismatch');
        result = {ok: !errors.length, errors, key: `${method} ${exchange.path}`};
      } else {
        result = validateRequest(subset, {method, url: url.toString(), headers});
      }
      let modeFixture = false;
      const send = (status: number, payload: unknown, extra: Record<string, string> = {}) => {
        requests.push({method, url: url.pathname + url.search, headers, body, ok: result.ok, errors: result.errors, key: result.key, served: status, modeFixture});
        res.writeHead(status, {'content-type': 'application/json', ...extra});
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      };
      if (!result.ok) violations.push(`${method} ${url.pathname}${url.search}: ${result.errors.join('; ')}`);
      if (mode === 'unauthorized') return send(401, {error: 'unauthorized'});
      if (!exchange) {
        if (mode === 'server_error_always' || (mode === 'server_error_once' && !erroredOnce)) { erroredOnce = true; return send(500, {error: 'internal'}); }
        if (mode === 'rate_limited') return send(429, {error: 'rate_limited'}, {'retry-after': '120'});
        if (mode === 'huge') return send(200, JSON.stringify({pad: 'x'.repeat(2 * 1024 * 1024)}));
        if (mode === 'slow') await new Promise((r) => setTimeout(r, opts.slowMs ?? 300));
      }
      const f = pick(method, url);
      modeFixture = !!f?.modes?.length;
      if (!f) {
        const nf = fixtures.find((x) => x.notFound);
        return send(nf?.status ?? 404, nf?.body ?? {error: 'not_found'});
      }
      return send(f.status, f.body, f.contentType ? {'content-type': f.contentType} : {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    violations,
    subset,
    setMode(m: MockMode) { mode = m; erroredOnce = false; },
    reset() { requests.length = 0; violations.length = 0; },
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
export type Mock = Awaited<ReturnType<typeof startMock>>;
