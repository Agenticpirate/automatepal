// In-repo subset of OpenAPI 3.0/3.1 + JSON Schema validation for hermetic billing contract tests.
// Supports local $ref, type (incl. 3.1 type arrays), nullable, enum, const, required, properties, items,
// allOf/anyOf/oneOf (oneOf is checked as "at least one", which is lenient by design),
// additionalProperties (false or schema), format date-time, string length/pattern and numeric bounds.
import fs from 'node:fs';
import path from 'node:path';

type Json = unknown;
type Obj = Record<string, unknown>;
export type SpecDoc = {file: string; openapi?: string; info?: Obj; servers?: {url: string}[]; security?: Obj[]; paths: Record<string, Obj>; components?: Obj};
export type Subset = {provider: string; documents: SpecDoc[]};
export type MatchedOperation = {doc: SpecDoc; template: string; method: string; op: Obj; pathParams: Record<string, string>; basePath: string};
export type RequestInput = {method: string; url: string; headers: Record<string, string>};
export type RequestResult = {ok: boolean; errors: string[]; key?: string};

export const SPEC_ROOT = path.join(process.cwd(), 'fixtures', 'billing-specs');

export function loadSubset(provider: string): Subset {
  const file = path.join(SPEC_ROOT, provider, 'subset.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Subset;
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function resolveRef(doc: SpecDoc, node: unknown, depth = 0): unknown {
  if (!isObj(node) || typeof node.$ref !== 'string') return node;
  if (depth > 32) throw Error('ref depth exceeded');
  const ref = node.$ref;
  if (!ref.startsWith('#/')) throw Error('non-local $ref ' + ref);
  const target = ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), doc);
  if (target === undefined) throw Error('unresolved $ref ' + ref);
  return resolveRef(doc, target, depth + 1);
}

// Server variables (e.g. Chargebee's {site}) are filled with their defaults before parsing.
export function serverBasePath(doc: SpecDoc): string {
  const server = doc.servers?.[0] as {url?: string; variables?: Record<string, {default?: string}>} | undefined;
  const url = server?.url;
  if (!url) return '';
  const filled = url.replace(/\{([^}]+)\}/g, (_m, k: string) => server?.variables?.[k]?.default ?? 'x');
  try { return new URL(filled).pathname.replace(/\/$/, ''); } catch { return url.startsWith('/') ? url.replace(/\/$/, '') : ''; }
}

function templateRegex(template: string): {re: RegExp; names: string[]} {
  const names: string[] = [];
  const src = template.split(/(\{[^}]+\})/).map((part) => {
    const m = part.match(/^\{([^}]+)\}$/);
    if (m) { names.push(m[1]); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return {re: new RegExp('^' + src + '$'), names};
}

// Literal path segments win over templated ones, like a router would.
export function matchOperation(subset: Subset, method: string, pathname: string): MatchedOperation | null {
  const m = method.toLowerCase();
  const candidates: (MatchedOperation & {score: number})[] = [];
  for (const doc of subset.documents) {
    const base = serverBasePath(doc);
    const rel = base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;
    for (const [template, item] of Object.entries(doc.paths)) {
      const op = item[m];
      if (!isObj(op)) continue;
      const {re, names} = templateRegex(template);
      const hit = rel.match(re);
      if (!hit) continue;
      const pathParams: Record<string, string> = {};
      names.forEach((n, i) => { pathParams[n] = decodeURIComponent(hit[i + 1]); });
      candidates.push({doc, template, method: m, op, pathParams, basePath: base, score: template.split('/').filter((s) => s && !s.startsWith('{')).length});
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

type Param = {name: string; in: string; required?: boolean; schema?: Obj; explode?: boolean; style?: string};
function operationParams(doc: SpecDoc, template: string, op: Obj): Param[] {
  const item = doc.paths[template] as Obj;
  const all = [...((item.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])].map((p) => resolveRef(doc, p) as Param);
  const byKey = new Map<string, Param>();
  for (const p of all) byKey.set(p.in + ':' + p.name, p);
  return [...byKey.values()];
}

function coerce(raw: string, schema: Obj | undefined, doc: SpecDoc): unknown {
  const s = schema ? (resolveRef(doc, schema) as Obj) : undefined;
  const t = Array.isArray(s?.type) ? (s!.type as string[]).find((x) => x !== 'null') : (s?.type as string | undefined);
  if (t === 'integer' || t === 'number') return raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  if (t === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : raw;
  if (t === 'array') return raw.split(',');
  return raw;
}

function securityErrors(doc: SpecDoc, op: Obj, headers: Record<string, string>): string[] {
  const req = (op.security as Obj[] | undefined) ?? doc.security;
  const schemes = ((doc.components as Obj | undefined)?.securitySchemes ?? {}) as Record<string, Obj>;
  const names = req && req.length ? req.flatMap((r) => Object.keys(r)) : Object.keys(schemes);
  if (!names.length) return [];
  const h = (n: string) => headers[n.toLowerCase()];
  const auth = h('authorization') ?? '';
  const satisfied = names.some((name) => {
    const s = resolveRef(doc, schemes[name]) as Obj | undefined;
    if (!s) return false;
    if (s.type === 'oauth2' || s.type === 'openIdConnect' || (s.type === 'http' && String(s.scheme).toLowerCase() === 'bearer')) return /^Bearer [^\s]{8,}$/.test(auth);
    if (s.type === 'http' && String(s.scheme).toLowerCase() === 'basic') {
      const m = auth.match(/^Basic ([A-Za-z0-9+/=]+)$/);
      return !!m && Buffer.from(m[1], 'base64').toString('utf8').includes(':');
    }
    if (s.type === 'apiKey' && s.in === 'header') return !!h(String(s.name));
    return false;
  });
  return satisfied ? [] : ['auth header does not match securitySchemes ' + names.join('|')];
}

export function validateRequest(subset: Subset, input: RequestInput, opts: {skipAuth?: boolean} = {}): RequestResult {
  const url = new URL(input.url);
  const match = matchOperation(subset, input.method, url.pathname);
  if (!match) return {ok: false, errors: [`no ${input.method} operation for ${url.pathname}`]};
  const errors: string[] = [];
  const headers = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const params = operationParams(match.doc, match.template, match.op);
  const declaredQuery = new Set(params.filter((p) => p.in === 'query').map((p) => p.name));
  // deepObject query parameters arrive as name[key]=value (Chargebee filters such as customer_id[is]).
  const deep = new Map<string, Record<string, string>>();
  for (const key of new Set(url.searchParams.keys())) {
    const m = key.match(/^([^[\]]+)\[([^[\]]+)\]$/);
    const p = m && params.find((x) => x.in === 'query' && x.name === m[1]);
    if (m && p && (p.style === 'deepObject' || (resolveRef(match.doc, p.schema) as Obj | undefined)?.type === 'object')) { deep.set(m[1], {...deep.get(m[1]), [m[2]]: url.searchParams.get(key) ?? ''}); continue; }
    if (!declaredQuery.has(key)) errors.push(`undeclared query parameter ${key}`);
  }
  for (const p of params) {
    let raw: string | undefined;
    if (p.in === 'query' && deep.has(p.name)) { if (p.schema) errors.push(...validateSchema(match.doc, p.schema, deep.get(p.name), `query.${p.name}`)); continue; }
    if (p.in === 'path') raw = match.pathParams[p.name];
    else if (p.in === 'query') raw = url.searchParams.get(p.name) ?? undefined;
    else if (p.in === 'header') raw = headers[p.name.toLowerCase()];
    else continue;
    if (raw === undefined) {
      // Authorization is checked against securitySchemes, not as a plain header parameter.
      if (p.required && !(p.in === 'header' && p.name.toLowerCase() === 'authorization')) errors.push(`missing required ${p.in} parameter ${p.name}`);
      continue;
    }
    if (p.in === 'header' && p.name.toLowerCase() === 'authorization') continue;
    if (p.schema) errors.push(...validateSchema(match.doc, p.schema, coerce(raw, p.schema, match.doc), `${p.in}.${p.name}`));
  }
  if (!opts.skipAuth) errors.push(...securityErrors(match.doc, match.op, headers));
  return {ok: errors.length === 0, errors, key: `${input.method.toUpperCase()} ${match.template}`};
}

export function responseSchema(subset: Subset, method: string, template: string, status: number): {doc: SpecDoc; schema: Obj} | null {
  for (const doc of subset.documents) {
    const op = (doc.paths[template] as Obj | undefined)?.[method.toLowerCase()] as Obj | undefined;
    if (!op) continue;
    const responses = (op.responses ?? {}) as Obj;
    const r0 = responses[String(status)] ?? responses[`${String(status)[0]}XX`] ?? responses.default;
    if (!r0) return null;
    const r = resolveRef(doc, r0) as Obj;
    const content = (r.content ?? {}) as Record<string, Obj>;
    const media = Object.entries(content).find(([t]) => /json/i.test(t));
    if (!media || !media[1].schema) return null;
    return {doc, schema: media[1].schema as Obj};
  }
  return null;
}

export function validateResponse(subset: Subset, method: string, template: string, status: number, body: Json): string[] {
  const found = responseSchema(subset, method, template, status);
  if (!found) return [`no JSON response schema for ${method} ${template} ${status}`];
  return validateSchema(found.doc, found.schema, body, '$');
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const regexCache = new Map<string, RegExp | null>();
function compile(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  for (const flags of ['u', '']) { try { re = new RegExp(pattern, flags); break; } catch { /* Java-style or unsupported pattern: skipped */ } }
  regexCache.set(pattern, re);
  return re;
}
function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(t: string, v: unknown): boolean {
  const actual = typeOf(v);
  return t === actual || (t === 'number' && actual === 'integer');
}

export function validateSchema(doc: SpecDoc, schema0: unknown, value: unknown, at: string, depth = 0): string[] {
  if (depth > 64) return [];
  const schema = resolveRef(doc, schema0);
  if (schema === true || schema === undefined) return [];
  if (schema === false) return [`${at}: not allowed`];
  if (!isObj(schema)) return [];
  const errors: string[] = [];
  const nullable = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'));
  if (value === null && nullable) return [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => typeMatches(t, value))) return [`${at}: expected ${types.join('|')}, got ${typeOf(value)}`];
  }
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    // Providers add enum values over time; an unknown string is reported, not silently accepted.
    errors.push(`${at}: ${JSON.stringify(value)} not in enum`);
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${at}: const mismatch`);
  if (typeof value === 'string') {
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) errors.push(`${at}: not date-time`);
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (typeof schema.pattern === 'string') { const re = compile(schema.pattern); if (re && !re.test(value)) errors.push(`${at}: does not match pattern`); }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at}: below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at}: above maximum`);
  }
  if (Array.isArray(schema.allOf)) for (const s of schema.allOf) errors.push(...validateSchema(doc, s, value, at, depth + 1));
  for (const k of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[k])) {
      const branches = schema[k] as unknown[];
      if (!branches.some((s) => validateSchema(doc, s, value, at, depth + 1).length === 0)) errors.push(`${at}: matches no ${k} branch`);
    }
  }
  if (isObj(value)) {
    const props = (isObj(schema.properties) ? schema.properties : {}) as Obj;
    for (const r of (schema.required as string[] | undefined) ?? []) if (!(r in value)) errors.push(`${at}: missing required ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errors.push(...validateSchema(doc, props[k], v, `${at}.${k}`, depth + 1));
      else if (schema.additionalProperties === false && !hasPropInCombinators(doc, schema, k)) errors.push(`${at}: unexpected property ${k}`);
      else if (isObj(schema.additionalProperties)) errors.push(...validateSchema(doc, schema.additionalProperties, v, `${at}.${k}`, depth + 1));
    }
  }
  if (Array.isArray(value) && schema.items !== undefined) value.forEach((v, i) => errors.push(...validateSchema(doc, schema.items, v, `${at}[${i}]`, depth + 1)));
  return errors;
}
function hasPropInCombinators(doc: SpecDoc, schema: Obj, key: string): boolean {
  for (const k of ['allOf', 'anyOf', 'oneOf']) for (const s of (schema[k] as unknown[] | undefined) ?? []) {
    const r = resolveRef(doc, s) as Obj;
    if (isObj(r.properties) && key in r.properties) return true;
  }
  return false;
}

// True when the subset declares this exact method + template.
export function hasOperation(subset: Subset, method: string, template: string): boolean {
  return subset.documents.some((d) => isObj((d.paths[template] as Obj | undefined)?.[method.toLowerCase()]));
}
export function declaredQueryParams(subset: Subset, method: string, template: string): string[] {
  for (const doc of subset.documents) {
    const op = (doc.paths[template] as Obj | undefined)?.[method.toLowerCase()] as Obj | undefined;
    if (op) return operationParams(doc, template, op).filter((p) => p.in === 'query').map((p) => p.name);
  }
  return [];
}
export function declaredServers(subset: Subset): string[] {
  return [...new Set(subset.documents.flatMap((d) => (d.servers ?? []).map((s) => s.url)))];
}
