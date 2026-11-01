// Fixture helper: the smallest object that satisfies a vendored schema's required fields
// (nullable -> null, enum -> first value, arrays empty), deep-merged with hand-written overrides.
// Usage (CLI): node scripts/billing-specs/fixture-skeleton.mjs <provider> <schemaName> [docIndex]
// The fixture files themselves are plain JSON and are validated by the contract tests.
import fs from 'node:fs';
import path from 'node:path';

const resolve = (doc, node) => {
  let n = node, i = 0;
  while (n && n.$ref && i++ < 32) n = n.$ref.slice(2).split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
  return n;
};
export function skeleton(doc, schema0, depth = 0) {
  const s = resolve(doc, schema0);
  if (!s || depth > 12) return null;
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (s.nullable || types.includes('null')) return null;
  if (s.enum) return s.enum[0];
  if (s.allOf) {
    const parts = s.allOf.map((x) => skeleton(doc, x, depth + 1));
    const objs = parts.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    return objs.length ? Object.assign({}, ...objs) : parts.find((x) => x !== null && x !== undefined) ?? null;
  }
  const branch = s.anyOf ?? s.oneOf;
  if (branch) {
    const nullable = branch.some((b) => { const r = resolve(doc, b); return r?.type === 'null' || (Array.isArray(r?.type) && r.type.length === 1 && r.type[0] === 'null') || (r?.enum?.length === 1 && r.enum[0] === ''); });
    if (nullable) return null;
    return skeleton(doc, branch[0], depth + 1);
  }
  const t = types.find((x) => x !== 'null') ?? (s.properties ? 'object' : undefined);
  if (t === 'string') return s.format === 'date-time' ? '2026-10-01T00:00:00Z' : 'x';
  if (t === 'integer' || t === 'number') return s.minimum ?? 0;
  if (t === 'boolean') return false;
  if (t === 'array') return [];
  if (t === 'object') {
    const out = {};
    for (const r of s.required ?? []) out[r] = skeleton(doc, s.properties?.[r] ?? {}, depth + 1);
    return out;
  }
  return null;
}
export function merge(base, over) {
  if (over === undefined) return base;
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object' || Array.isArray(base)) return over;
  const out = {...base};
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}
export function loadDoc(provider, index = 0) {
  return JSON.parse(fs.readFileSync(path.join('fixtures', 'billing-specs', provider, 'subset.json'), 'utf8')).documents[index];
}
export const build = (doc, name, over) => merge(skeleton(doc, {$ref: '#/components/schemas/' + name}), over);

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [provider, name, idx] = process.argv.slice(2);
  if (!provider || !name) { console.error('Usage: node scripts/billing-specs/fixture-skeleton.mjs <provider> <schemaName> [docIndex]'); process.exit(2); }
  console.log(JSON.stringify(skeleton(loadDoc(provider, Number(idx ?? 0)), {$ref: '#/components/schemas/' + name}), null, 1));
}
