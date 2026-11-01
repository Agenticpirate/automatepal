import {BillingError, type AdapterDeps, type BillingMode, type OperationSpec, type ProviderDefinition} from './types';
import {breakerAllows, breakerFailure, breakerSuccess, inCooldown, setCooldown, takeToken} from './breaker';

// Outbound hardening for every provider call: allowlist first (read-only enforced in code),
// then cooldown, breaker and token bucket, then fetch with a 10 s timeout, redirect:'error',
// a 1 MB streamed body cap, one jittered retry on network errors/5xx, and Retry-After on 429.
export const TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 1024 * 1024;
const SHORT_RETRY_AFTER_MS = 2_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const SEGMENT = /^[A-Za-z0-9._~%:@!$&'()*+,;=-]+$/;

export type GuardedOp = {method: string; path: string; query?: Record<string, string | number | undefined>; body?: string; headers?: Record<string, string>};
export type GuardedResponse = {status: number; data: unknown; headers: Headers};

function templateMatches(template: string, concrete: string): boolean {
  const t = template.split('/'), c = concrete.split('/');
  if (t.length !== c.length) return false;
  return t.every((seg, i) => {
    const v = c[i];
    if (/^\{[^}]+\}$/.test(seg)) {
      if (!v || !SEGMENT.test(v)) return false;
      let decoded = v;
      try { decoded = decodeURIComponent(v); } catch { return false; }
      return decoded !== '.' && decoded !== '..' && !decoded.includes('/');
    }
    return seg === v;
  });
}

// The only gate between an adapter and the network.
export function allowlisted(definition: Pick<ProviderDefinition, 'operations'>, op: GuardedOp): OperationSpec | null {
  const method = op.method.toUpperCase();
  const keys = Object.entries(op.query ?? {}).filter(([, v]) => v !== undefined).map(([k]) => k);
  for (const spec of definition.operations) {
    if (spec.method !== method) continue;
    if (!templateMatches(spec.path, op.path)) continue;
    if (!keys.every((k) => (spec.query ?? []).includes(k))) continue;
    if (method === 'GET' && op.body === undefined) return spec;
    // POST is permitted only for a named auth exchange with its exact fixed body.
    if (method === 'POST' && spec.authExchange && spec.body !== undefined && op.body === spec.body) return spec;
  }
  return null;
}

export function resolveBaseUrl(definition: ProviderDefinition, mode: BillingMode, deps: Pick<AdapterDeps, 'baseUrlOverride' | 'config'>): string {
  const base = definition.baseUrl ? definition.baseUrl(mode, deps.config ?? {}) : definition.modes[mode].baseUrl;
  const u = new URL(base);
  if (u.protocol !== 'https:') throw new BillingError('invalid_credential', {publicMessage: 'Provider base URL must use HTTPS.'});
  if (deps.baseUrlOverride) {
    const o = new URL(deps.baseUrlOverride);
    if (process.env.NODE_ENV === 'production' || o.hostname !== '127.0.0.1' || o.protocol !== 'http:') throw new BillingError('invalid_credential', {publicMessage: 'Base URL override refused.'});
    return o.origin + u.pathname.replace(/\/$/, '');
  }
  return u.origin + u.pathname.replace(/\/$/, '');
}

export function parseRetryAfter(v: string | null, now: number): number | null {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

async function readCapped(res: Response, max: number): Promise<string> {
  const declared = res.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > max) throw new BillingError('provider_error');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel().catch(() => undefined); throw new BillingError('provider_error'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

type Attempt = {kind: 'ok'; res: Response} | {kind: 'network'} | {kind: 'timeout'};
async function attempt(deps: AdapterDeps, url: string, init: RequestInit): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {...init, signal: ctrl.signal, redirect: 'error'});
    return {kind: 'ok', res};
  } catch {
    return ctrl.signal.aborted ? {kind: 'timeout'} : {kind: 'network'};
  } finally { clearTimeout(timer); }
}

export async function guardedRequest(args: {definition: ProviderDefinition; mode: BillingMode; baseUrl: string; op: GuardedOp; auth: Record<string, string>; connectionId: string; deps: AdapterDeps}): Promise<GuardedResponse> {
  const {definition, op, deps, connectionId} = args;
  const spec = allowlisted(definition, op);
  if (!spec) throw new BillingError('write_blocked');
  const now = deps.now();
  if (inCooldown(connectionId, now)) throw new BillingError('rate_limited');
  if (!breakerAllows(connectionId, now)) throw new BillingError('circuit_open');
  if (!takeToken(connectionId, now)) throw new BillingError('rate_limited');

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(op.query ?? {})) if (v !== undefined) qs.set(k, String(v));
  const search = qs.toString();
  const url = args.baseUrl + op.path + (search ? '?' + search : '');
  const headers: Record<string, string> = {Accept: 'application/json', ...(definition.defaultHeaders ?? {}), ...(op.headers ?? {}), ...args.auth};
  const init: RequestInit = {method: spec.method, headers, ...(op.body !== undefined ? {body: op.body} : {})};
  const jitter = () => 250 + Math.floor((deps.random ?? Math.random)() * 500);

  let retried = false, retried429 = false;
  while (true) {
    const a = await attempt(deps, url, init);
    if (a.kind === 'timeout') { breakerFailure(connectionId, deps.now()); throw new BillingError('timeout'); }
    if (a.kind === 'network') {
      if (!retried) { retried = true; await deps.sleep(jitter()); continue; }
      breakerFailure(connectionId, deps.now());
      throw new BillingError('provider_error');
    }
    const res = a.res;
    if (res.status >= 500) {
      await res.body?.cancel().catch(() => undefined);
      if (!retried) { retried = true; await deps.sleep(jitter()); continue; }
      breakerFailure(connectionId, deps.now());
      throw new BillingError('provider_error', {httpStatus: res.status});
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      const wait = parseRetryAfter(res.headers.get('retry-after'), deps.now());
      if (wait !== null && wait <= SHORT_RETRY_AFTER_MS && !retried429) { retried429 = true; await deps.sleep(wait); continue; }
      setCooldown(connectionId, deps.now() + (wait ?? DEFAULT_COOLDOWN_MS));
      throw new BillingError('rate_limited', {httpStatus: 429});
    }
    if (res.status === 401 || res.status === 403) { await res.body?.cancel().catch(() => undefined); breakerSuccess(connectionId); throw new BillingError('auth_failed', {httpStatus: res.status}); }
    if (res.status === 404) { await res.body?.cancel().catch(() => undefined); breakerSuccess(connectionId); throw new BillingError('not_found', {httpStatus: 404}); }
    if (res.status < 200 || res.status >= 300) { await res.body?.cancel().catch(() => undefined); throw new BillingError('provider_error', {httpStatus: res.status}); }
    const text = await readCapped(res, MAX_BODY_BYTES);
    let data: unknown = null;
    if (text) { try { data = JSON.parse(text); } catch { throw new BillingError('provider_error', {httpStatus: res.status}); } }
    breakerSuccess(connectionId);
    return {status: res.status, data, headers: res.headers};
  }
}

// Thin per-adapter client: fills path templates with encoded values and always goes through guardedRequest.
export function providerClient(definition: ProviderDefinition, mode: BillingMode, deps: AdapterDeps, auth: () => Promise<Record<string, string>>) {
  const baseUrl = resolveBaseUrl(definition, mode, deps);
  const byId = new Map(definition.operations.map((o) => [o.id, o]));
  const fill = (template: string, params: Record<string, string>) => template.replace(/\{([^}]+)\}/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined || v === '') throw new BillingError('not_found');
    return encodeURIComponent(v);
  });
  return {
    baseUrl,
    async get<T = unknown>(opId: string, params: Record<string, string> = {}, query: Record<string, string | number | undefined> = {}): Promise<T> {
      const spec = byId.get(opId);
      if (!spec) throw new BillingError('write_blocked');
      const r = await guardedRequest({definition, mode, baseUrl, op: {method: spec.method, path: fill(spec.path, params), query}, auth: await auth(), connectionId: deps.connectionId, deps});
      return r.data as T;
    },
    async exchange<T = unknown>(opId: string, headers: Record<string, string>, body: string): Promise<T> {
      const spec = byId.get(opId);
      if (!spec?.authExchange) throw new BillingError('write_blocked');
      const r = await guardedRequest({definition, mode, baseUrl, op: {method: spec.method, path: spec.path, body, headers}, auth: headers, connectionId: deps.connectionId, deps});
      return r.data as T;
    },
  };
}
export type ProviderClient = ReturnType<typeof providerClient>;
