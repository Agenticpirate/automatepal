// Shared billing-support contract. Every provider module implements ProviderDefinition.
// Read-only by construction: adapters only reach the network through guardedRequest (http.ts),
// which refuses anything outside the provider's GET allowlist (plus one named auth exchange).

export const BILLING_PROVIDER_IDS = ['paypal', 'stripe', 'dodo', 'razorpay', 'paddle', 'square', 'adyen', 'mollie', 'chargebee', 'lemonsqueezy', 'polar', 'braintree', 'cashfree'] as const;
export type BillingProviderId = (typeof BILLING_PROVIDER_IDS)[number];
export type BillingMode = 'test' | 'live';
export const BILLING_INTENTS = ['order_status', 'payment_history', 'failed_payment', 'invoice', 'renewal', 'refund_status'] as const;
export type BillingIntent = (typeof BILLING_INTENTS)[number];
export type SourceConfidence = 'official-spec' | 'official-spec-early-access' | 'docs-derived';

export type RecordKind = 'order' | 'charge' | 'payment' | 'invoice' | 'subscription' | 'refund' | 'transaction';

// What a verified visitor may read. Sealed (encrypted) before it is stored; never holds email.
export type BillingScope = {
  provider: BillingProviderId;
  mode: BillingMode;
  customerId: string | null;
  recordIds: string[];
  recordKinds: Record<string, RecordKind>;
};

export type BillingRefund = {id: string; status: string; amountMinor: number | null; currency: string | null; createdAt: string | null};
export type BillingRecord = {
  provider: BillingProviderId;
  mode: BillingMode;
  kind: RecordKind;
  id: string;
  displayRef: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  createdAt: string | null;
  hostedUrl: string | null;
  renewalAt: string | null;
  failure: {message: string | null; attemptCount: number | null; nextRetryAt: string | null} | null;
  refunds: BillingRefund[];
  customerRef: string | null;
  parentRef: string | null;
};
// What the browser receives: no internal customer reference.
export type BillingCard = Omit<BillingRecord, 'customerRef'> & {providerLabel: string};

export type OperationSpec = {id: string; method: 'GET' | 'POST'; path: string; query?: string[]; authExchange?: boolean; body?: string; file?: string};
export type CredentialField = {name: string; label: string; secret: boolean; placeholder?: string};
export type ConfigField = {name: string; label: string; placeholder?: string; liveOnly?: boolean};
export type CredentialCheck = {ok: true; keyHint: string; warning?: string} | {ok: false; code: 'refused_key' | 'invalid_credential' | 'mode_mismatch'; message: string};
export type ReferencePattern = {kind: RecordKind | 'invoice_number' | 'customer'; pattern: RegExp; label: string};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
export type AdapterDeps = {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  connectionId: string;
  // Tests only: origin of a local mock server. Refused in production and for non-127.0.0.1 hosts.
  baseUrlOverride?: string;
  timeoutMs?: number;
  config?: Record<string, string>;
  random?: () => number;
};

export type VerifyResult = {status: 'verified'; scope: BillingScope; record: BillingRecord} | {status: 'mismatch'} | {status: 'not_found'};
export interface BillingAdapter {
  testConnection(): Promise<{ok: true; accountLabel?: string; warning?: string}>;
  verifyCustomer(reference: string, email: string): Promise<VerifyResult>;
  lookup(scope: BillingScope, intent: BillingIntent): Promise<BillingRecord[]>;
}

export type Capability = {supported: boolean; operations: string[]};
export type ProviderDefinition = {
  id: BillingProviderId;
  label: string;
  tier: 'A' | 'B' | 'C';
  source: {confidence: SourceConfidence};
  modes: {test: {baseUrl: string}; live: {baseUrl: string}};
  // Only Adyen (live prefix) and Chargebee (site) derive the host from validated config.
  baseUrl?: (mode: BillingMode, config: Record<string, string>) => string;
  credentialFields: CredentialField[];
  configFields?: ConfigField[];
  validateCredential(mode: BillingMode, cred: Record<string, string>, config?: Record<string, string>): CredentialCheck;
  operations: OperationSpec[];
  capabilities: Record<BillingIntent, Capability>;
  referencePatterns: ReferencePattern[];
  hostedHosts: {test: string[]; live: string[]};
  defaultHeaders?: Record<string, string>;
  createAdapter(cred: Record<string, string>, mode: BillingMode, deps: AdapterDeps): BillingAdapter;
};

export type BillingErrorCode = 'auth_failed' | 'not_found' | 'rate_limited' | 'provider_error' | 'timeout' | 'circuit_open' | 'write_blocked' | 'invalid_credential' | 'mode_mismatch' | 'refused_key' | 'unsupported';
export class BillingError extends Error {
  readonly code: BillingErrorCode;
  // Our own fixed text only (never provider response content).
  readonly publicMessage?: string;
  readonly httpStatus?: number;
  constructor(code: BillingErrorCode, opts: {publicMessage?: string; httpStatus?: number} = {}) {
    super(code);
    this.name = 'BillingError';
    this.code = code;
    this.publicMessage = opts.publicMessage;
    this.httpStatus = opts.httpStatus;
  }
}
