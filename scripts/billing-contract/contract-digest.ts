// Same validation API as openapi.ts, over a contract.json digest. Used for sources with no
// license (Mollie: machine-generated names/types/required only) and docs-derived sources
// (Razorpay, Lemon Squeezy: hand-written from the provider docs pages listed in SOURCE.json).
import fs from 'node:fs';
import path from 'node:path';
import {SPEC_ROOT, type Subset, type SpecDoc} from './openapi';
export {validateRequest, validateResponse, matchOperation, hasOperation, declaredQueryParams, declaredServers} from './openapi';

type DigestParam = {name: string; in: 'path' | 'query' | 'header'; required?: boolean; schema?: Record<string, unknown>};
export type Contract = {
  provider: string;
  servers: string[];
  auth: {type: string; scheme?: string; in?: string; name?: string}[];
  operations: Record<string, {method: string; path: string; params: DigestParam[]; responses: Record<string, {contentType?: string; schema: Record<string, unknown>}>}>;
  // Shared schemas referenced as #/components/schemas/<name> (hand-written digests).
  components?: {schemas?: Record<string, unknown>};
};

export function contractToSubset(c: Contract): Subset {
  const securitySchemes = Object.fromEntries(c.auth.map((a, i) => [`auth${i}`, a]));
  const paths: SpecDoc['paths'] = {};
  for (const op of Object.values(c.operations)) {
    paths[op.path] ??= {};
    paths[op.path][op.method.toLowerCase()] = {
      parameters: op.params,
      responses: Object.fromEntries(Object.entries(op.responses).map(([s, r]) => [s, {content: {[r.contentType ?? 'application/json']: {schema: r.schema}}}])),
    };
  }
  return {provider: c.provider, documents: [{file: 'contract.json', servers: c.servers.map((url) => ({url})), paths, components: {securitySchemes, schemas: c.components?.schemas ?? {}}}]};
}

export function loadContract(provider: string): Subset {
  const c = JSON.parse(fs.readFileSync(path.join(SPEC_ROOT, provider, 'contract.json'), 'utf8')) as Contract;
  return contractToSubset(c);
}

// One entry point for tests: subset.json when vendored, contract.json otherwise.
export function loadProviderContract(provider: string): {subset: Subset; kind: 'subset' | 'digest'} {
  if (fs.existsSync(path.join(SPEC_ROOT, provider, 'subset.json'))) {
    return {subset: JSON.parse(fs.readFileSync(path.join(SPEC_ROOT, provider, 'subset.json'), 'utf8')) as Subset, kind: 'subset'};
  }
  return {subset: loadContract(provider), kind: 'digest'};
}
