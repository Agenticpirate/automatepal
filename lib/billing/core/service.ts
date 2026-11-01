import {credentialAad, decryptCredential, openScope, sealScope, serverProof} from './crypto';
import {cacheGet, cacheSet} from './cache';
import {composeBillingAnswer, unsupportedSentence, modeFooter, type BillingAnswer} from './answer';
import {redactId} from './redact';
import {filterScoped} from './scope';
import {matchReference} from './verify';
import {enabledDefinition} from './registry';
import {BillingError, type AdapterDeps, type BillingAdapter, type BillingIntent, type BillingMode, type BillingProviderId, type BillingRecord, type ProviderDefinition} from './types';
import {EMPTY_META, type BillingOutcome, type BillingStore, type LookupMeta, type StoredConnection} from './store';

// Visitor billing flow. Order of work for every call: reserve in the DB (rate limits, attempt caps,
// paused cases come back as refusals), then decrypt, then the read-only adapter, then filterScoped,
// then finish with metadata only.
export type ServiceDeps = {
  store: BillingStore;
  now?: () => number;
  definitionFor?: (id: BillingProviderId) => ProviderDefinition | null;
  adapterDeps?: (connection: StoredConnection) => Partial<AdapterDeps>;
  adapterFactory?: (definition: ProviderDefinition, cred: Record<string, string>, mode: BillingMode, deps: AdapterDeps) => BillingAdapter;
};

export const VERIFY_FAILED = "We couldn't match that reference and email. Check both and try again.";
export const VERIFY_REQUIRED = 'To look up billing details, confirm your order or invoice number and the email used to pay.';
const REFUSALS: Record<string, string> = {
  rate_limited: 'Billing lookups are busy right now. Try again in a few minutes.',
  too_many_attempts: 'Too many verification attempts on this chat. Ask a person to review instead.',
  case_paused: 'Case paused or unavailable. Ask a person to review.',
  not_connected: 'Billing lookups are not available for this chat.',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function depsFor(d: ServiceDeps, c: StoredConnection): AdapterDeps {
  return {fetch: (u, i) => fetch(u, i), now: d.now ?? Date.now, sleep, connectionId: c.id, config: c.config ?? {}, ...(d.adapterDeps?.(c) ?? {})};
}
function adapterFor(d: ServiceDeps, def: ProviderDefinition, c: StoredConnection, workspaceId: string): BillingAdapter {
  const cred = JSON.parse(decryptCredential(c.ciphertext, credentialAad(workspaceId, c.provider, c.mode))) as Record<string, string>;
  const deps = depsFor(d, c);
  return d.adapterFactory ? d.adapterFactory(def, cred, c.mode, deps) : def.createAdapter(cred, c.mode, deps);
}
const metaOf = (r: BillingRecord | undefined): LookupMeta => (r ? {recordKind: r.kind, recordRef: redactId(r.id), recordStatus: r.status.slice(0, 40), amountMinor: r.amountMinor, currency: r.currency} : EMPTY_META);
function outcomeOf(e: unknown): BillingOutcome {
  if (e instanceof BillingError) {
    if (e.code === 'rate_limited') return 'rate_limited';
    if (e.code === 'circuit_open') return 'circuit_open';
    if (e.code === 'not_found') return 'not_found';
  }
  return 'provider_error';
}

// Without BILLING_RPC_SECRET no connection can exist, so a missing proof reads as "not connected".
function proofOrNull(): string | null {
  try { return serverProof(); } catch { return null; }
}

export type VerifyOutcome = {ok: true; provider: BillingProviderId; mode: BillingMode; expiresAt: string | null; lookupId: string} | {ok: false; error: string; status: number};

export async function verifyVisitor(d: ServiceDeps, input: {caseHash: string; provider: BillingProviderId; reference: string; email: string}): Promise<VerifyOutcome> {
  const def = (d.definitionFor ?? enabledDefinition)(input.provider);
  const proof = proofOrNull();
  if (!def || !proof) return {ok: false, error: REFUSALS.not_connected, status: 400};
  const reserved = await d.store.reserve(input.caseHash, proof, 'verify', input.provider, null);
  if (reserved.refused || !reserved.id) return {ok: false, error: REFUSALS[reserved.refused ?? 'not_connected'], status: reserved.refused === 'rate_limited' ? 429 : 400};
  const lookupId = reserved.id;
  const fail = async (outcome: BillingOutcome, error = VERIFY_FAILED, status = 400): Promise<VerifyOutcome> => {
    await d.store.finish(input.caseHash, proof, lookupId, outcome, EMPTY_META, null);
    return {ok: false, error, status};
  };
  const ref = matchReference(def, input.reference);
  if (!ref) return fail('not_found');
  const ctx = await d.store.context(input.caseHash, proof);
  const conn = ctx?.connections.find((c) => c.provider === input.provider);
  if (!ctx || !conn) return fail('refused', REFUSALS.not_connected);
  try {
    const result = await adapterFor(d, def, conn, ctx.workspaceId).verifyCustomer(ref.value, input.email);
    if (result.status !== 'verified') return fail(result.status);
    const scope = {...result.scope, recordIds: result.scope.recordIds.slice(0, 20)};
    const done = await d.store.finish(input.caseHash, proof, lookupId, 'verified', metaOf(result.record), sealScope(scope, input.caseHash));
    if (!done.ok) return {ok: false, error: REFUSALS.case_paused, status: 400};
    return {ok: true, provider: input.provider, mode: conn.mode, expiresAt: done.expiresAt, lookupId};
  } catch (e) {
    const outcome = outcomeOf(e);
    // A provider 404 during verification reads exactly like a mismatch.
    if (outcome === 'not_found') return fail('not_found');
    return fail(outcome, outcome === 'rate_limited' || outcome === 'circuit_open' ? REFUSALS.rate_limited : 'The payment provider is unavailable right now. Try again later or ask a person to review.', 503);
  }
}

export type AnswerOutcome =
  | {ok: true; answer: BillingAnswer; lookupId: string; mode: BillingMode; provider: BillingProviderId; outcome: BillingOutcome}
  | {ok: false; kind: 'verification_required' | 'refused' | 'error'; error: string; status: number};

export async function answerBilling(d: ServiceDeps, input: {caseHash: string; intent: BillingIntent}): Promise<AnswerOutcome> {
  const status = await d.store.status(input.caseHash);
  const provider = status?.verified?.provider;
  if (!provider) return {ok: false, kind: 'verification_required', error: VERIFY_REQUIRED, status: 200};
  const def = (d.definitionFor ?? enabledDefinition)(provider);
  const proof = proofOrNull();
  if (!def || !proof) return {ok: false, kind: 'refused', error: REFUSALS.not_connected, status: 400};
  const reserved = await d.store.reserve(input.caseHash, proof, 'lookup', provider, input.intent);
  if (reserved.refused || !reserved.id) return {ok: false, kind: 'refused', error: REFUSALS[reserved.refused ?? 'not_connected'], status: reserved.refused === 'rate_limited' ? 429 : 400};
  const lookupId = reserved.id;
  const mode = reserved.mode ?? 'test';
  if (!def.capabilities[input.intent].supported) {
    await d.store.finish(input.caseHash, proof, lookupId, 'unsupported', EMPTY_META, null);
    return {ok: true, answer: {answer: `${unsupportedSentence(def.label)} ${modeFooter(mode)}`, supported: false, sources: [], cards: []}, lookupId, mode, provider, outcome: 'unsupported'};
  }
  const ctx = await d.store.context(input.caseHash, proof);
  const conn = ctx?.connections.find((c) => c.provider === provider);
  const v = ctx?.verification;
  const scope = v && v.provider === provider && Date.parse(v.expiresAt) > (d.now ?? Date.now)() ? openScope(v.scope, input.caseHash, provider) : null;
  if (!ctx || !conn || !v || !scope || scope.mode !== conn.mode) {
    await d.store.finish(input.caseHash, proof, lookupId, 'refused', EMPTY_META, null);
    return {ok: false, kind: 'verification_required', error: VERIFY_REQUIRED, status: 200};
  }
  try {
    const now = (d.now ?? Date.now)();
    let records = cacheGet(conn.id, v.id, input.intent, now);
    if (!records) {
      records = filterScoped(scope, await adapterFor(d, def, conn, ctx.workspaceId).lookup(scope, input.intent));
      cacheSet(conn.id, v.id, input.intent, records, now);
    }
    // Re-check on every return path, cached or not.
    records = filterScoped(scope, records);
    const answer = composeBillingAnswer(def, input.intent, records, conn.mode);
    const outcome: BillingOutcome = records.length ? 'answered' : 'no_records';
    const done = await d.store.finish(input.caseHash, proof, lookupId, outcome, metaOf(records[0]), null);
    if (!done.ok) return {ok: false, kind: 'refused', error: REFUSALS.case_paused, status: 400};
    return {ok: true, answer, lookupId, mode: conn.mode, provider, outcome};
  } catch (e) {
    const outcome = outcomeOf(e) === 'not_found' ? 'no_records' : outcomeOf(e);
    await d.store.finish(input.caseHash, proof, lookupId, outcome, EMPTY_META, null);
    if (outcome === 'no_records') return {ok: true, answer: composeBillingAnswer(def, input.intent, [], conn.mode), lookupId, mode: conn.mode, provider, outcome};
    return {ok: false, kind: 'error', error: outcome === 'rate_limited' || outcome === 'circuit_open' ? REFUSALS.rate_limited : 'The payment provider is unavailable right now. Try again later or ask a person to review.', status: 503};
  }
}

export const REFUND_NOTE = 'Sent to the owner for refund review with the payment attached. No refund has been issued and no money moved.';
// Opens the existing refund-review ticket. Never calls a provider.
export async function requestRefundReview(d: ServiceDeps, input: {caseHash: string; lookupId: string; message: string}): Promise<{ok: true; id: string; note: string} | {ok: false; error: string}> {
  const id = await d.store.refundRequest(input.caseHash, input.lookupId, input.message);
  return id ? {ok: true, id, note: REFUND_NOTE} : {ok: false, error: 'Refund review needs a verified payment lookup on this chat. Request limit may be reached.'};
}
