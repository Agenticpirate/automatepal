import type {BillingIntent, BillingMode, BillingProviderId} from './types';

// Persistence boundary for visitor billing. The Supabase implementation (store-supabase.ts) maps
// each method to one 044 RPC keyed by the case token hash. Only metadata crosses this boundary:
// no email, no raw reference text, no card data. Scopes are sealed (encrypted) before finish().
export type BillingOutcome = 'verified' | 'mismatch' | 'not_found' | 'answered' | 'no_records' | 'unsupported' | 'provider_error' | 'rate_limited' | 'circuit_open' | 'refused';
export type BillingRefusal = 'rate_limited' | 'too_many_attempts' | 'case_paused' | 'not_connected';
export type StoredConnection = {id: string; provider: BillingProviderId; mode: BillingMode; ciphertext: string; keyId: string; config: Record<string, string>};
export type BillingStatus = {providers: {provider: BillingProviderId; mode: BillingMode}[]; verified: {provider: BillingProviderId; expiresAt: string} | null};
export type BillingContext = {
  workspaceId: string;
  inboxState: string;
  connections: StoredConnection[];
  verification: {id: string; provider: BillingProviderId; scope: unknown; expiresAt: string} | null;
};
export type ReserveResult = {id: string | null; mode: BillingMode | null; refused: BillingRefusal | null};
export type LookupMeta = {recordKind: string | null; recordRef: string | null; recordStatus: string | null; amountMinor: number | null; currency: string | null};
export const EMPTY_META: LookupMeta = {recordKind: null, recordRef: null, recordStatus: null, amountMinor: null, currency: null};

export interface BillingStore {
  status(caseHash: string): Promise<BillingStatus | null>;
  context(caseHash: string, proof: string): Promise<BillingContext | null>;
  // reserve and finish need the server proof (serverProof()); the anon key alone cannot write lookups.
  reserve(caseHash: string, proof: string, kind: 'verify' | 'lookup', provider: BillingProviderId, intent: BillingIntent | null): Promise<ReserveResult>;
  finish(caseHash: string, proof: string, lookupId: string, outcome: BillingOutcome, meta: LookupMeta, scope: {sealed: string} | null): Promise<{ok: boolean; expiresAt: string | null}>;
  refundRequest(caseHash: string, lookupId: string, message: string): Promise<string | null>;
}
