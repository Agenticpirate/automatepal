import operations from '../../../fixtures/billing-specs/paddle/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Paddle Billing (spec: PaddleHQ/paddle-openapi v1/openapi.yaml @ c8207382fa0f, Apache-2.0).
// Bearer key. Sandbox keys contain _sdbx (developer.paddle.com/sdks/sandbox).
type Envelope<T> = {data?: T};
type Txn = {id?: string; status?: string; customer_id?: string | null; subscription_id?: string | null; invoice_number?: string | null; currency_code?: string; created_at?: string; billed_at?: string | null; details?: {totals?: {total?: string; grand_total?: string}} | null; payments?: {status?: string; error_code?: string | null; created_at?: string}[]};
type Sub = {id?: string; status?: string; customer_id?: string; currency_code?: string; created_at?: string; next_billed_at?: string | null; items?: {price?: {unit_price?: {amount?: string}}; quantity?: number}[]};
type Adjustment = {id?: string; action?: string; status?: string; transaction_id?: string; customer_id?: string; currency_code?: string; created_at?: string; totals?: {total?: string}};

const OPS = operations as OperationSpec[];
const cap = (ops: string[]) => ({supported: true, operations: ops});
const minor = (v?: string | null) => (v && /^-?\d+$/.test(v) ? Number(v) : null);
const KEY = /^pdl_(sdbx|live)_apikey_[A-Za-z0-9_]{20,120}$/;
function base(mode: BillingMode, kind: RecordKind, id: string, created?: string): BillingRecord {
  return {provider: 'paddle', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
function txnRecord(mode: BillingMode, t: Txn): BillingRecord {
  const failed = (t.payments ?? []).filter((p) => p.status === 'error' || p.status === 'failed' || p.status === 'action_required');
  return {
    ...base(mode, 'transaction', t.id ?? '', t.billed_at ?? t.created_at), displayRef: t.invoice_number || t.id || '', status: t.status ?? 'unknown', amountMinor: minor(t.details?.totals?.grand_total ?? t.details?.totals?.total), currency: upperCurrency(t.currency_code),
    customerRef: t.customer_id ?? null, parentRef: t.subscription_id ?? null,
    failure: t.status === 'past_due' || failed.length ? {message: (failed.at(-1)?.error_code ?? 'payment failed').replace(/_/g, ' '), attemptCount: failed.length || null, nextRetryAt: null} : null,
  };
}
const subRecord = (mode: BillingMode, s: Sub): BillingRecord => ({
  ...base(mode, 'subscription', s.id ?? '', s.created_at), status: s.status ?? 'unknown', currency: upperCurrency(s.currency_code), renewalAt: isoTime(s.next_billed_at ?? undefined), customerRef: s.customer_id ?? null,
  amountMinor: (s.items ?? []).reduce<number | null>((n, i) => { const a = minor(i.price?.unit_price?.amount); return a === null ? n : (n ?? 0) + a * (i.quantity ?? 1); }, null),
  failure: s.status === 'past_due' ? {message: 'subscription payment past due', attemptCount: null, nextRetryAt: null} : null,
});

export const definition: ProviderDefinition = {
  id: 'paddle',
  label: 'Paddle',
  tier: 'A',
  source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://sandbox-api.paddle.com'}, live: {baseUrl: 'https://api.paddle.com'}},
  credentialFields: [{name: 'apiKey', label: 'API key (read permissions)', secret: true, placeholder: 'pdl_sdbx_apikey_…'}],
  validateCredential(mode, cred) {
    const k = (cred.apiKey ?? '').trim();
    if (!KEY.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter a Paddle API key (pdl_sdbx_apikey_… for sandbox, pdl_live_apikey_… for live).'};
    const sandbox = k.includes('_sdbx');
    if (mode === 'test' && !sandbox) return {ok: false, code: 'mode_mismatch', message: 'That is a live Paddle key. Sandbox keys contain _sdbx.'};
    if (mode === 'live' && sandbox) return {ok: false, code: 'mode_mismatch', message: 'That is a sandbox Paddle key. Choose Test mode.'};
    return {ok: true, keyHint: `${k.slice(0, 16)}…${k.slice(-4)}`};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['transactions.get', 'subscriptions.get']),
    payment_history: cap(['transactions.list']),
    failed_payment: cap(['transactions.list', 'subscriptions.list']),
    invoice: cap(['transactions.get', 'transactions.list', 'transactions.invoice']),
    renewal: cap(['subscriptions.list', 'subscriptions.get']),
    refund_status: cap(['adjustments.list']),
  },
  referencePatterns: [
    {kind: 'transaction', pattern: /^txn_[a-z0-9]{26}$/, label: 'Transaction ID (txn_…)'},
    {kind: 'subscription', pattern: /^sub_[a-z0-9]{26}$/, label: 'Subscription ID (sub_…)'},
    {kind: 'invoice_number', pattern: /^[0-9]{1,8}-[0-9]{1,10}$/, label: 'Invoice number'},
  ],
  // Invoice PDFs are short-lived signed links on Paddle's invoice storage host.
  hostedHosts: {test: ['paddle-sandbox-invoice-service-pdfs.s3.amazonaws.com'], live: ['paddle-production-invoice-service-pdfs.s3.amazonaws.com']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.apiKey}`}));
    const scope = (customer: string | null, id: string, kind: RecordKind): BillingScope => ({provider: 'paddle', mode, customerId: customer, recordIds: [id], recordKinds: {[id]: kind}});
    const emailOf = async (customer?: string | null) => (customer ? (await get<Envelope<{email?: string}>>('customers.get', {customer_id: customer})).data?.email ?? null : null);
    const customerTxns = async (s: BillingScope, status?: string) => s.customerId ? ((await get<Envelope<Txn[]>>('transactions.list', {}, {customer_id: s.customerId, ...(status ? {status} : {}), per_page: 10})).data ?? []).filter((t) => t.customer_id === s.customerId) : [];
    async function withInvoice(t: Txn): Promise<BillingRecord> {
      const r = txnRecord(mode, t);
      if (t.invoice_number && (t.status === 'billed' || t.status === 'paid' || t.status === 'completed' || t.status === 'past_due')) r.hostedUrl = (await get<Envelope<{url?: string}>>('transactions.invoice', {transaction_id: r.id})).data?.url ?? null;
      return r;
    }
    return {
      async testConnection() {
        await get('transactions.list', {}, {per_page: 1});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          if (/^txn_/.test(reference) || /^[0-9]+-[0-9]+$/.test(reference)) {
            const t = /^txn_/.test(reference)
              ? (await get<Envelope<Txn>>('transactions.get', {transaction_id: reference})).data
              : ((await get<Envelope<Txn[]>>('transactions.list', {}, {invoice_number: reference, per_page: 10})).data ?? []).find((x) => x.invoice_number === reference);
            if (!t?.id || (/^txn_/.test(reference) && t.id !== reference)) return {status: 'not_found'};
            return emailMatches(email, await emailOf(t.customer_id)) ? {status: 'verified', scope: scope(t.customer_id ?? null, t.id, 'transaction'), record: txnRecord(mode, t)} : {status: 'mismatch'};
          }
          const sub = (await get<Envelope<Sub>>('subscriptions.get', {subscription_id: reference})).data;
          if (sub?.id !== reference) return {status: 'not_found'};
          return emailMatches(email, await emailOf(sub.customer_id)) ? {status: 'verified', scope: scope(sub.customer_id ?? null, reference, 'subscription'), record: subRecord(mode, sub)} : {status: 'mismatch'};
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const ids = s.recordIds.slice(0, 5);
        const subs = async () => s.customerId ? ((await get<Envelope<Sub[]>>('subscriptions.list', {}, {customer_id: s.customerId, per_page: 10})).data ?? []).filter((x) => x.customer_id === s.customerId).map((x) => subRecord(mode, x)) : [];
        switch (intent) {
          case 'order_status': {
            const out: BillingRecord[] = [];
            for (const id of ids) {
              if (s.recordKinds[id] === 'transaction') { const t = (await get<Envelope<Txn>>('transactions.get', {transaction_id: id})).data; if (t) out.push(txnRecord(mode, t)); }
              else if (s.recordKinds[id] === 'subscription') { const x = (await get<Envelope<Sub>>('subscriptions.get', {subscription_id: id})).data; if (x) out.push(subRecord(mode, x)); }
            }
            return out;
          }
          case 'payment_history': return (await customerTxns(s)).map((t) => txnRecord(mode, t));
          case 'failed_payment': return [...(await subs()).filter((r) => r.failure), ...(await customerTxns(s, 'past_due')).map((t) => txnRecord(mode, t))];
          case 'invoice': {
            const txns = s.customerId ? await customerTxns(s) : [];
            const out: BillingRecord[] = [];
            for (const t of txns.filter((x) => x.invoice_number).slice(0, 3)) out.push(await withInvoice(t));
            return out;
          }
          case 'renewal': return (await subs()).filter((r) => r.renewalAt);
          case 'refund_status': {
            if (!s.customerId) return [];
            const adj = (await get<Envelope<Adjustment[]>>('adjustments.list', {}, {customer_id: s.customerId, action: 'refund', per_page: 10})).data ?? [];
            return adj.filter((a) => a.customer_id === s.customerId).map((a) => ({...base(mode, 'refund', a.id ?? '', a.created_at), status: a.status ?? 'unknown', amountMinor: minor(a.totals?.total), currency: upperCurrency(a.currency_code), customerRef: a.customer_id ?? null, parentRef: a.transaction_id ?? null}));
          }
        }
      },
    };
  },
};
