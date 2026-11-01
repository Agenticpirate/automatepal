import operations from '../../../fixtures/billing-specs/lemonsqueezy/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Lemon Squeezy (JSON:API), docs-derived contract from docs.lemonsqueezy.com/api. Bearer API key.
// One host for both modes: every resource carries test_mode, which must match the connection mode.
type Res<T> = {data?: {id?: string; attributes?: T}};
type ResList<T> = {data?: {id?: string; attributes?: T}[]};
type Order = {customer_id?: number; order_number?: number; user_email?: string; currency?: string; total?: number; status?: string; refunded?: boolean; refunded_amount?: number; refunded_at?: string | null; test_mode?: boolean; urls?: {receipt?: string}; created_at?: string};
type Sub = {customer_id?: number; order_id?: number; user_email?: string; status?: string; renews_at?: string | null; test_mode?: boolean; created_at?: string};
type Invoice = {subscription_id?: number; customer_id?: number; status?: string; total?: number; currency?: string; refunded?: boolean; refunded_amount?: number; refunded_at?: string | null; test_mode?: boolean; urls?: {invoice_url?: string | null}; created_at?: string};

const OPS = operations as OperationSpec[];
const cap = (ops: string[]) => ({supported: true, operations: ops});
function base(mode: BillingMode, kind: RecordKind, id: string, created?: string): BillingRecord {
  return {provider: 'lemonsqueezy', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const refundsOf = (id: string, a: {refunded?: boolean; refunded_amount?: number; refunded_at?: string | null; currency?: string}) => (a.refunded || (a.refunded_amount ?? 0) > 0 ? [{id, status: 'refunded', amountMinor: a.refunded_amount ?? null, currency: upperCurrency(a.currency), createdAt: isoTime(a.refunded_at ?? undefined)}] : []);
const orderRecord = (mode: BillingMode, id: string, a: Order): BillingRecord => ({...base(mode, 'order', id, a.created_at), displayRef: a.order_number ? `#${a.order_number}` : id, status: a.status ?? 'unknown', amountMinor: a.total ?? null, currency: upperCurrency(a.currency), hostedUrl: a.urls?.receipt ?? null, customerRef: a.customer_id ? String(a.customer_id) : null, refunds: refundsOf(id, a),
  failure: a.status === 'failed' ? {message: 'payment failed', attemptCount: null, nextRetryAt: null} : null});
const subRecord = (mode: BillingMode, id: string, a: Sub): BillingRecord => ({...base(mode, 'subscription', id, a.created_at), status: a.status ?? 'unknown', renewalAt: a.status === 'active' || a.status === 'on_trial' || a.status === 'past_due' ? isoTime(a.renews_at ?? undefined) : null, customerRef: a.customer_id ? String(a.customer_id) : null,
  failure: a.status === 'past_due' || a.status === 'unpaid' ? {message: a.status === 'unpaid' ? 'renewal unpaid after retries' : 'renewal payment failed; retrying', attemptCount: null, nextRetryAt: a.status === 'past_due' ? isoTime(a.renews_at ?? undefined) : null} : null});
const invoiceRecord = (mode: BillingMode, id: string, a: Invoice): BillingRecord => ({...base(mode, 'invoice', id, a.created_at), status: a.status ?? 'unknown', amountMinor: a.total ?? null, currency: upperCurrency(a.currency), hostedUrl: a.urls?.invoice_url ?? null, customerRef: a.customer_id ? String(a.customer_id) : null, parentRef: a.subscription_id ? String(a.subscription_id) : null, refunds: refundsOf(id, a),
  failure: a.status === 'pending' ? {message: 'invoice awaiting payment', attemptCount: null, nextRetryAt: null} : null});

export const definition: ProviderDefinition = {
  id: 'lemonsqueezy',
  label: 'Lemon Squeezy',
  tier: 'B',
  source: {confidence: 'docs-derived'},
  modes: {test: {baseUrl: 'https://api.lemonsqueezy.com'}, live: {baseUrl: 'https://api.lemonsqueezy.com'}},
  credentialFields: [{name: 'apiKey', label: 'API key', secret: true}],
  validateCredential(mode, cred) {
    const k = (cred.apiKey ?? '').trim();
    if (!/^[A-Za-z0-9._-]{40,2000}$/.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter a Lemon Squeezy API key.'};
    return {ok: true, keyHint: `${k.slice(0, 4)}…${k.slice(-4)}`, warning: `Lemon Squeezy keys are not read-only; AutomatePal only calls the read endpoints listed for this connection. The connect check confirms the key reads ${mode === 'live' ? 'live' : 'test-mode'} data.`};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['orders.get', 'subscriptions.get']),
    payment_history: cap(['orders.get', 'subscription_invoices.list']),
    failed_payment: cap(['subscriptions.get', 'subscription_invoices.list']),
    invoice: cap(['orders.get', 'subscription_invoices.list']),
    renewal: cap(['subscriptions.get']),
    refund_status: cap(['orders.get', 'subscription_invoices.list']),
  },
  referencePatterns: [{kind: 'order', pattern: /^[0-9]{1,12}$/, label: 'Order ID or subscription ID'}],
  hostedHosts: {test: ['app.lemonsqueezy.com'], live: ['app.lemonsqueezy.com']},
  defaultHeaders: {Accept: 'application/vnd.api+json'},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.apiKey}`}));
    const sameMode = (a?: {test_mode?: boolean}) => a?.test_mode === (mode === 'test');
    const scope = (customer: number | undefined, id: string, kind: RecordKind): BillingScope => ({provider: 'lemonsqueezy', mode, customerId: customer ? String(customer) : null, recordIds: [id], recordKinds: {[id]: kind}});
    const notFound = (e: unknown) => e instanceof BillingError && e.code === 'not_found';
    const invoices = async (subId: string) => ((await get<ResList<Invoice>>('subscription_invoices.list', {}, {'filter[subscription_id]': subId, 'page[size]': 10})).data ?? [])
      .filter((x) => x.id && sameMode(x.attributes) && String(x.attributes?.subscription_id) === subId).map((x) => invoiceRecord(mode, x.id!, x.attributes!));
    return {
      async testConnection() {
        await get('users.me');
        const first = (await get<ResList<Order>>('orders.list', {}, {'page[size]': 1})).data?.[0]?.attributes;
        if (first && typeof first.test_mode === 'boolean' && !sameMode(first)) throw new BillingError('mode_mismatch', {publicMessage: `That key reads ${first.test_mode ? 'test-mode' : 'live'} data, but ${mode === 'live' ? 'LIVE' : 'Test'} mode was selected.`});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          try {
            const o = (await get<Res<Order>>('orders.get', {id: reference})).data;
            if (o?.id !== reference || !sameMode(o.attributes)) return {status: 'not_found'};
            return emailMatches(email, o.attributes?.user_email) ? {status: 'verified', scope: scope(o.attributes?.customer_id, reference, 'order'), record: orderRecord(mode, reference, o.attributes!)} : {status: 'mismatch'};
          } catch (e) { if (!notFound(e)) throw e; }
          const s = (await get<Res<Sub>>('subscriptions.get', {id: reference})).data;
          if (s?.id !== reference || !sameMode(s.attributes)) return {status: 'not_found'};
          return emailMatches(email, s.attributes?.user_email) ? {status: 'verified', scope: scope(s.attributes?.customer_id, reference, 'subscription'), record: subRecord(mode, reference, s.attributes!)} : {status: 'mismatch'};
        } catch (e) {
          if (notFound(e)) return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const out: BillingRecord[] = [];
        for (const id of s.recordIds.slice(0, 5)) {
          if (s.recordKinds[id] === 'order') {
            if (intent === 'renewal' || intent === 'failed_payment') continue;
            const o = (await get<Res<Order>>('orders.get', {id})).data;
            if (o?.attributes && sameMode(o.attributes)) out.push(orderRecord(mode, id, o.attributes));
          } else {
            if (intent === 'order_status' || intent === 'renewal' || intent === 'failed_payment') {
              const x = (await get<Res<Sub>>('subscriptions.get', {id})).data;
              if (x?.attributes && sameMode(x.attributes)) out.push(subRecord(mode, id, x.attributes));
            }
            if (intent === 'payment_history' || intent === 'invoice' || intent === 'refund_status' || intent === 'failed_payment') out.push(...await invoices(id));
          }
        }
        if (intent === 'failed_payment') return out.filter((r) => r.failure);
        if (intent === 'refund_status') return out.filter((r) => r.refunds.length || /refund/.test(r.status));
        if (intent === 'invoice') return out.filter((r) => r.hostedUrl);
        return out;
      },
    };
  },
};
