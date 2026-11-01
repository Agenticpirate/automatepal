// In-memory BillingStore that mirrors the 044 RPC rules (limits, attempt caps, paused cases,
// 30-minute verification, refund-request preconditions). Records every argument for deep scans.
import {randomUUID} from 'node:crypto';
import {encryptCredential, credentialAad, proofHash, serverProof} from '../../lib/billing/core/crypto';
import type {BillingStore, BillingOutcome, LookupMeta, StoredConnection} from '../../lib/billing/core/store';
import type {BillingIntent, BillingMode, BillingProviderId} from '../../lib/billing/core/types';

type Case = {id: string; workspaceId: string; inboxState: string; expiresAt: number};
type Lookup = {id: string; caseId: string; workspaceId: string; provider: BillingProviderId; mode: BillingMode; kind: 'verify' | 'lookup'; intent: BillingIntent | null; outcome: BillingOutcome | 'pending'; meta: LookupMeta | null; at: number};
type Verification = {id: string; caseId: string; provider: BillingProviderId; scope: {sealed: string}; expiresAt: number};

export function memoryStore(now: () => number = Date.now) {
  const cases = new Map<string, Case>();
  const connections: (StoredConnection & {workspaceId: string; proofHash: string})[] = [];
  const lookups: Lookup[] = [];
  const verifications: Verification[] = [];
  const requests: {id: string; caseId: string; lookupId: string; message: string}[] = [];
  const audit: {workspaceId: string; resource: string; resourceId: string}[] = [];
  const calls: {method: string; args: unknown[]}[] = [];
  const rec = (method: string, args: unknown[]) => calls.push({method, args: JSON.parse(JSON.stringify(args))});
  const caseOf = (h: string) => { const c = cases.get(h); return c && c.expiresAt > now() ? c : null; };

  const store: BillingStore = {
    async status(h) {
      rec('status', [h]);
      const c = caseOf(h);
      if (!c) return null;
      const v = verifications.filter((x) => x.caseId === c.id && x.expiresAt > now()).at(-1);
      return {providers: connections.filter((x) => x.workspaceId === c.workspaceId).map((x) => ({provider: x.provider, mode: x.mode})), verified: v ? {provider: v.provider, expiresAt: new Date(v.expiresAt).toISOString()} : null};
    },
    async context(h, proof) {
      rec('context', [h, '[proof]']);
      const c = caseOf(h);
      if (!c) return null;
      const okProof = (x: {proofHash: string}) => x.proofHash === proofHash(proof);
      const v = verifications.filter((x) => x.caseId === c.id && x.expiresAt > now()).at(-1);
      return {
        workspaceId: c.workspaceId, inboxState: c.inboxState,
        connections: connections.filter((x) => x.workspaceId === c.workspaceId && okProof(x)).map(({workspaceId: _w, proofHash: _p, ...rest}) => { void _w; void _p; return rest; }),
        verification: v ? {id: v.id, provider: v.provider, scope: v.scope, expiresAt: new Date(v.expiresAt).toISOString()} : null,
      };
    },
    async reserve(h, proof, kind, provider, intent) {
      rec('reserve', [h, '[proof]', kind, provider, intent]);
      const c = caseOf(h);
      if (!c) return {id: null, mode: null, refused: 'case_paused'};
      const conn = connections.find((x) => x.workspaceId === c.workspaceId && x.provider === provider);
      if (!conn || conn.proofHash !== proofHash(proof)) return {id: null, mode: null, refused: 'not_connected'};
      if (kind === 'lookup' && (c.inboxState === 'taken_over' || c.inboxState === 'closed')) return {id: null, mode: null, refused: 'case_paused'};
      const t = now();
      const mine = lookups.filter((l) => l.caseId === c.id);
      if (kind === 'verify' && mine.filter((l) => l.kind === 'verify' && (l.outcome === 'mismatch' || l.outcome === 'not_found')).length >= 5) return {id: null, mode: null, refused: 'too_many_attempts'};
      if (mine.length >= 30) return {id: null, mode: null, refused: 'rate_limited'};
      const ws = lookups.filter((l) => l.workspaceId === c.workspaceId);
      if (ws.filter((l) => l.at > t - 600_000).length >= 60 || ws.filter((l) => l.provider === provider && l.at > t - 600_000).length >= 30) return {id: null, mode: null, refused: 'rate_limited'};
      const id = randomUUID();
      lookups.push({id, caseId: c.id, workspaceId: c.workspaceId, provider, mode: conn.mode, kind, intent, outcome: 'pending', meta: null, at: t});
      audit.push({workspaceId: c.workspaceId, resource: 'billing_lookups', resourceId: id});
      return {id, mode: conn.mode, refused: null};
    },
    async finish(h, proof, id, outcome, meta, scope) {
      rec('finish', [h, '[proof]', id, outcome, meta, scope]);
      const c = caseOf(h);
      const l = lookups.find((x) => x.id === id && x.caseId === c?.id && x.outcome === 'pending');
      if (!c || !l) return {ok: false, expiresAt: null};
      if (!connections.some((x) => x.workspaceId === c.workspaceId && x.provider === l.provider && x.proofHash === proofHash(proof))) return {ok: false, expiresAt: null};
      if (l.kind === 'lookup' && (c.inboxState === 'taken_over' || c.inboxState === 'closed')) return {ok: false, expiresAt: null};
      l.outcome = outcome; l.meta = meta;
      if (outcome === 'verified' && scope) {
        const expiresAt = Math.min(now() + 30 * 60_000, c.expiresAt);
        verifications.push({id: randomUUID(), caseId: c.id, provider: l.provider, scope, expiresAt});
        return {ok: true, expiresAt: new Date(expiresAt).toISOString()};
      }
      return {ok: true, expiresAt: null};
    },
    async refundRequest(h, lookupId, message) {
      rec('refundRequest', [h, lookupId, message]);
      const c = caseOf(h);
      const l = lookups.find((x) => x.id === lookupId && x.caseId === c?.id);
      if (!c || !l || !['verified', 'answered'].includes(l.outcome) || !l.meta?.recordRef) return null;
      if (requests.filter((r) => r.caseId === c.id).length >= 5) return null;
      const id = randomUUID();
      requests.push({id, caseId: c.id, lookupId, message});
      return id;
    },
  };
  return {
    store, cases, connections, lookups, verifications, requests, audit, calls,
    addCase(h: string, workspaceId: string, inboxState = 'open', ttlMs = 3_600_000) { const c = {id: randomUUID(), workspaceId, inboxState, expiresAt: now() + ttlMs}; cases.set(h, c); return c; },
    connect(workspaceId: string, provider: BillingProviderId, mode: BillingMode, cred: Record<string, string>, config: Record<string, string> = {}) {
      const {blob, keyId} = encryptCredential(JSON.stringify(cred), credentialAad(workspaceId, provider, mode));
      const c = {id: randomUUID(), workspaceId, provider, mode, ciphertext: blob, keyId, config, proofHash: proofHash(serverProof())};
      connections.push(c);
      return c;
    },
  };
}
