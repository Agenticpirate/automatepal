import operations from '../../../fixtures/billing-specs/dodo/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Dodo Payments (spec: per-endpoint OpenAPI 3.1 excerpts on docs.dodopayments.com, info.version
// 1.120.26, Apache 2.0 per info.license). Bearer key; test and live are separate hosts.
type Customer = {customer_id?: string; email?: string | null};
type Payment = {payment_id?: string; status?: string | null; total_amount?: number; currency?: string; created_at?: string; customer?: Customer; invoice_url?: string | null; error_message?: string | null; retry_attempt?: number | null; subscription_id?: string | null; refunds?: {refund_id?: string; status?: string; amount?: number | null; currency?: string | null; created_at?: string}[]};
type Subscription = {subscription_id?: string; status?: string; recurring_pre_tax_amount?: number; currency?: string; created_at?: string; next_billing_date?: string; customer?: Customer};
type Refund = {refund_id?: string; payment_id?: string; status?: string; amount?: number | null; currency?: string | null; created_at?: string};
type Retry = {automatic_retry_number?: number | null; next_automatic_retry_at?: string | null; reason?: string | null};
type Items<T> = {items?: T[]};

const OPS = operations as OperationSpec[];
const KEY = /^[A-Za-z0-9._-]{20,200}$/;
const cap = (ops: string[]) => ({supported: true, operations: ops});
function base(mode: BillingMode, kind: RecordKind, id: string, created?: string): BillingRecord {
  return {provider: 'dodo', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const paymentRecord = (mode: BillingMode, p: Payment): BillingRecord => ({
  ...base(mode, 'payment', p.payment_id ?? '', p.created_at), status: p.status ?? 'unknown', amountMinor: p.total_amount ?? null, currency: upperCurrency(p.currency), customerRef: p.customer?.customer_id ?? null, hostedUrl: p.invoice_url ?? null, parentRef: p.subscription_id ?? null,
  failure: p.status === 'failed' ? {message: p.error_message ?? 'payment failed', attemptCount: p.retry_attempt ?? null, nextRetryAt: null} : null,
  refunds: (p.refunds ?? []).map((r) => ({id: r.refund_id ?? '', status: r.status ?? 'unknown', amountMinor: r.amount ?? null, currency: upperCurrency(r.currency), createdAt: isoTime(r.created_at)})),
});
const subscriptionRecord = (mode: BillingMode, s: Subscription): BillingRecord => ({
  ...base(mode, 'subscription', s.subscription_id ?? '', s.created_at), status: s.status ?? 'unknown', amountMinor: s.recurring_pre_tax_amount ?? null, currency: upperCurrency(s.currency), renewalAt: isoTime(s.next_billing_date), customerRef: s.customer?.customer_id ?? null,
  failure: s.status === 'on_hold' || s.status === 'past_due' || s.status === 'failed' ? {message: `subscription ${s.status.replace(/_/g, ' ')}`, attemptCount: null, nextRetryAt: null} : null,
});

export const definition: ProviderDefinition = {
  id: 'dodo',
  label: 'Dodo Payments',
  tier: 'A',
  source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://test.dodopayments.com'}, live: {baseUrl: 'https://live.dodopayments.com'}},
  credentialFields: [{name: 'apiKey', label: 'API key', secret: true}],
  validateCredential(_mode, cred) {
    const k = (cred.apiKey ?? '').trim();
    if (!KEY.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter the Dodo Payments API key for the selected mode.'};
    return {ok: true, keyHint: `${k.slice(0, 4)}…${k.slice(-4)}`, warning: 'Dodo Payments keys are not read-only; AutomatePal only calls the read endpoints listed for this connection. A key from the other mode fails the connect check.'};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['payments.get', 'subscriptions.get']),
    payment_history: cap(['payments.list']),
    failed_payment: cap(['payments.get', 'payments.list', 'payments.retry_state', 'subscriptions.get']),
    invoice: cap(['payments.get', 'payments.list']),
    renewal: cap(['subscriptions.get', 'subscriptions.list']),
    refund_status: cap(['payments.list', 'refunds.list']),
  },
  referencePatterns: [
    {kind: 'payment', pattern: /^pay_[A-Za-z0-9]{8,64}$/, label: 'Payment ID (pay_…)'},
    {kind: 'subscription', pattern: /^sub_[A-Za-z0-9]{8,64}$/, label: 'Subscription ID (sub_…)'},
  ],
  // invoice_url hosts are not documented in the excerpt; only Dodo's own API hosts are trusted.
  hostedHosts: {test: ['test.dodopayments.com'], live: ['live.dodopayments.com']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.apiKey}`}));
    const scope = (customer: string | null, id: string, kind: RecordKind): BillingScope => ({provider: 'dodo', mode, customerId: customer, recordIds: [id], recordKinds: {[id]: kind}});
    // The provider filters by customer; the customer id on each row is checked again here.
    const customerPayments = async (s: BillingScope) => s.customerId ? ((await get<Items<Payment>>('payments.list', {}, {customer_id: s.customerId, page_size: 20})).items ?? []).filter((p) => p.customer?.customer_id === s.customerId) : [];
    return {
      async testConnection() {
        await get('payments.list', {}, {page_size: 1});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          if (/^pay_/.test(reference)) {
            const p = await get<Payment>('payments.get', {payment_id: reference});
            if (p.payment_id !== reference) return {status: 'not_found'};
            return emailMatches(email, p.customer?.email) ? {status: 'verified', scope: scope(p.customer?.customer_id ?? null, reference, 'payment'), record: paymentRecord(mode, p)} : {status: 'mismatch'};
          }
          const s = await get<Subscription>('subscriptions.get', {subscription_id: reference});
          if (s.subscription_id !== reference) return {status: 'not_found'};
          return emailMatches(email, s.customer?.email) ? {status: 'verified', scope: scope(s.customer?.customer_id ?? null, reference, 'subscription'), record: subscriptionRecord(mode, s)} : {status: 'mismatch'};
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const ids = s.recordIds.slice(0, 5);
        const own = async () => {
          const out: BillingRecord[] = [];
          for (const id of ids) {
            if (s.recordKinds[id] === 'payment') out.push(paymentRecord(mode, await get<Payment>('payments.get', {payment_id: id})));
            else if (s.recordKinds[id] === 'subscription') out.push(subscriptionRecord(mode, await get<Subscription>('subscriptions.get', {subscription_id: id})));
          }
          return out;
        };
        switch (intent) {
          case 'order_status': return own();
          case 'payment_history': return (await customerPayments(s)).map((p) => paymentRecord(mode, p));
          case 'invoice': return (s.customerId ? (await customerPayments(s)).map((p) => paymentRecord(mode, p)) : (await own()).filter((r) => r.kind === 'payment')).filter((r) => r.hostedUrl);
          case 'renewal': {
            const subs = s.customerId ? ((await get<Items<Subscription>>('subscriptions.list', {}, {customer_id: s.customerId, page_size: 20})).items ?? []).map((x) => subscriptionRecord(mode, x)) : (await own()).filter((r) => r.kind === 'subscription');
            return subs.filter((r) => r.renewalAt);
          }
          case 'failed_payment': {
            const out: BillingRecord[] = (await own()).filter((r) => r.kind === 'subscription' && r.failure);
            for (const p of (await customerPayments(s)).filter((x) => x.status === 'failed').slice(0, 3)) {
              const r = paymentRecord(mode, p);
              const retry = await get<Retry>('payments.retry_state', {payment_id: r.id}).catch((e) => { if (e instanceof BillingError && e.code === 'not_found') return null; throw e; });
              if (retry && r.failure) r.failure = {message: r.failure.message ?? retry.reason ?? null, attemptCount: retry.automatic_retry_number ?? r.failure.attemptCount, nextRetryAt: isoTime(retry.next_automatic_retry_at ?? undefined)};
              out.push(r);
            }
            return out;
          }
          case 'refund_status': {
            // The refunds list filters by customer; each refund must also point at one of that customer's payments.
            if (!s.customerId) return [];
            const payments = new Map((await customerPayments(s)).map((p) => [p.payment_id, p]));
            const refunds = (await get<Items<Refund>>('refunds.list', {}, {customer_id: s.customerId, page_size: 20})).items ?? [];
            return refunds.filter((r) => r.payment_id && payments.has(r.payment_id)).map((r) => ({
              ...base(mode, 'refund', r.refund_id ?? '', r.created_at), status: r.status ?? 'unknown', amountMinor: r.amount ?? null, currency: upperCurrency(r.currency), parentRef: r.payment_id ?? null, customerRef: payments.get(r.payment_id)?.customer?.customer_id ?? null,
            }));
          }
        }
      },
    };
  },
};
