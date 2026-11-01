import assert from 'node:assert/strict';
import type {BillingAdapter, BillingIntent, BillingMode, BillingProviderId, BillingRecord} from '../../lib/billing/core/types';
import type {Mock} from './mock-server';

// One per provider: fictional credentials, references for customers A and B, and the normalized
// values the adapter must produce from the fixtures.
export type Scenario = {
  provider: BillingProviderId;
  cred: Record<string, string>;
  config?: Record<string, string>;
  hosts: {test: string; live: string};
  // Same host for both modes (mode is decided by the key), e.g. Razorpay.
  sameHost?: boolean;
  // Hosts documented by the provider but not declared in the vendored contract's servers (with the reason in SOURCE.json notes).
  hostsNotInSpec?: string[];
  liveConfig?: Record<string, string>;
  verify: {ref: string; email: string; expect: 'verified' | 'mismatch' | 'not_found'; scopeIds?: string[]; customerId?: string | null}[];
  lookups: {ref: string; email: string; intent: BillingIntent; expect: (records: BillingRecord[]) => void}[];
  credentialRules: {mode: BillingMode; cred: Record<string, string>; config?: Record<string, string>; ok: boolean; code?: string; message?: RegExp}[];
  writeProbe: {method: string; path: string; body?: string};
  // verifyRejected: the mixed fixture answers the verification read itself with another customer's record.
  mixed?: {ref: string; email: string; intent: BillingIntent; forbiddenIds: string[]; verifyRejected?: boolean};
  // Mode check on connect (Stripe livemode, Lemon Squeezy test_mode, ...): a fixture-driven mismatch.
  modeMismatch?: {mode: BillingMode; cred: Record<string, string>; config?: Record<string, string>};
  // Provider-specific checks against the same mock; returns the number of checks run.
  extra?: (h: {mock: Mock; adapter: () => BillingAdapter}) => Promise<number>;
};

export const one = (records: BillingRecord[], pred: (r: BillingRecord) => boolean, label: string) => {
  const r = records.find(pred);
  assert.ok(r, `${label}: expected record not found among ${records.map((x) => `${x.kind}:${x.id}`).join(', ') || 'none'}`);
  return r!;
};
