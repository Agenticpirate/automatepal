import operations from '../../../fixtures/billing-specs/square/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Square (spec: square/connect-api-specification api.json @ 0689c901bdfe, Apache-2.0). Bearer token.
// Square's search endpoints are POST, so only by-id GET reads are allowlisted.
export const SQUARE_VERSION = '2026-09-16';
type Money = {amount?: number | null; currency?: string | null};
type Payment = {id?: string; status?: string; created_at?: string; amount_money?: Money; total_money?: Money; order_id?: string; customer_id?: string; buyer_email_address?: string; refund_ids?: string[]; receipt_url?: string; receipt_number?: string};
type Order = {id?: string; state?: string; created_at?: string; customer_id?: string; total_money?: Money; tenders?: {payment_id?: string}[]};
type Invoice = {id?: string; status?: string; created_at?: string; invoice_number?: string; public_url?: string; order_id?: string; subscription_id?: string; primary_recipient?: {customer_id?: string; email_address?: string}; next_payment_amount_money?: Money; payment_requests?: {computed_amount_money?: Money; due_date?: string}[]};
type Refund = {id?: string; status?: string; amount_money?: Money; created_at?: string; payment_id?: string};
type Subscription = {id?: string; status?: string; created_at?: string; customer_id?: string; charged_through_date?: string; price_override_money?: Money};

const OPS = operations as OperationSpec[];
const cap = (ops: string[]) => ({supported: true, operations: ops});
const money = (m?: Money) => ({amountMinor: typeof m?.amount === 'number' ? m.amount : null, currency: upperCurrency(m?.currency)});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function base(mode: BillingMode, kind: RecordKind, id: string, created?: string): BillingRecord {
  return {provider: 'square', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const paymentRecord = (mode: BillingMode, p: Payment): BillingRecord => ({...base(mode, 'payment', p.id ?? '', p.created_at), displayRef: p.receipt_number || p.id || '', status: p.status ?? 'unknown', ...money(p.total_money ?? p.amount_money), parentRef: p.order_id ?? null, customerRef: p.customer_id ?? null, hostedUrl: p.receipt_url ?? null,
  failure: p.status === 'FAILED' || p.status === 'CANCELED' ? {message: p.status === 'FAILED' ? 'payment failed' : 'payment canceled', attemptCount: null, nextRetryAt: null} : null});
const orderRecord = (mode: BillingMode, o: Order): BillingRecord => ({...base(mode, 'order', o.id ?? '', o.created_at), status: o.state ?? 'unknown', ...money(o.total_money), customerRef: o.customer_id ?? null});
const invoiceRecord = (mode: BillingMode, i: Invoice): BillingRecord => ({...base(mode, 'invoice', i.id ?? '', i.created_at), displayRef: i.invoice_number || i.id || '', status: i.status ?? 'unknown', ...money(i.payment_requests?.[0]?.computed_amount_money ?? i.next_payment_amount_money), hostedUrl: i.public_url ?? null, parentRef: i.order_id ?? null, customerRef: i.primary_recipient?.customer_id ?? null});
// charged_through_date is the last day already paid; the renewal is the day after.
function subscriptionRecord(mode: BillingMode, s: Subscription): BillingRecord {
  const through = s.charged_through_date && /^\d{4}-\d{2}-\d{2}$/.test(s.charged_through_date) ? new Date(Date.parse(s.charged_through_date + 'T00:00:00Z') + 86400_000).toISOString() : null;
  return {...base(mode, 'subscription', s.id ?? '', s.created_at), status: s.status ?? 'unknown', ...money(s.price_override_money), renewalAt: s.status === 'ACTIVE' ? through : null, customerRef: s.customer_id ?? null};
}

export const definition: ProviderDefinition = {
  id: 'square',
  label: 'Square',
  tier: 'B',
  source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://connect.squareupsandbox.com'}, live: {baseUrl: 'https://connect.squareup.com'}},
  credentialFields: [{name: 'accessToken', label: 'Access token (read scopes)', secret: true}],
  validateCredential(_mode, cred) {
    const k = (cred.accessToken ?? '').trim();
    if (!/^[A-Za-z0-9_-]{30,256}$/.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter a Square access token with read scopes (PAYMENTS_READ, ORDERS_READ, INVOICES_READ, SUBSCRIPTIONS_READ, CUSTOMERS_READ).'};
    return {ok: true, keyHint: `${k.slice(0, 4)}…${k.slice(-4)}`};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['payments.get', 'orders.get', 'invoices.get', 'subscriptions.get']),
    payment_history: cap(['orders.get', 'payments.get']),
    failed_payment: cap(['orders.get', 'payments.get']),
    invoice: cap(['invoices.get']),
    renewal: cap(['subscriptions.get']),
    refund_status: cap(['payments.get', 'orders.get', 'refunds.get']),
  },
  referencePatterns: [
    {kind: 'invoice', pattern: /^inv:[0-9]-[A-Za-z0-9_-]{10,80}$/, label: 'Invoice ID (inv:…)'},
    {kind: 'subscription', pattern: UUID, label: 'Subscription ID'},
    {kind: 'payment', pattern: /^[A-Za-z0-9]{20,48}$/, label: 'Payment or order ID'},
  ],
  hostedHosts: {test: ['squareupsandbox.com', 'sandbox.squareup.com'], live: ['squareup.com']},
  defaultHeaders: {'Square-Version': SQUARE_VERSION},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.accessToken}`}));
    const emailOf = async (direct?: string, customer?: string) => direct || (customer ? (await get<{customer?: {email_address?: string}}>('customers.get', {customer_id: customer})).customer?.email_address : undefined);
    const scope = (ids: [string, RecordKind][]): BillingScope => ({provider: 'square', mode, customerId: null, recordIds: ids.map(([i]) => i), recordKinds: Object.fromEntries(ids)});
    const notFound = (e: unknown) => e instanceof BillingError && e.code === 'not_found';
    async function payments(s: BillingScope): Promise<Payment[]> {
      const out: Payment[] = [];
      for (const id of s.recordIds.slice(0, 5)) {
        if (s.recordKinds[id] === 'payment' && !out.some((p) => p.id === id)) out.push((await get<{payment?: Payment}>('payments.get', {payment_id: id})).payment ?? {});
        if (s.recordKinds[id] === 'order') {
          const o = (await get<{order?: Order}>('orders.get', {order_id: id})).order;
          for (const t of (o?.tenders ?? []).slice(0, 5)) {
            if (!t.payment_id || out.some((p) => p.id === t.payment_id)) continue;
            const p = (await get<{payment?: Payment}>('payments.get', {payment_id: t.payment_id})).payment;
            if (p?.order_id === id) out.push(p);
          }
        }
      }
      return out.filter((p) => p.id);
    }
    return {
      async testConnection() {
        await get('payments.list', {}, {limit: 1});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          if (/^inv:/.test(reference)) {
            const i = (await get<{invoice?: Invoice}>('invoices.get', {invoice_id: reference})).invoice;
            if (i?.id !== reference) return {status: 'not_found'};
            const ids: [string, RecordKind][] = [[reference, 'invoice']];
            if (i.order_id) ids.push([i.order_id, 'order']);
            return emailMatches(email, await emailOf(i.primary_recipient?.email_address, i.primary_recipient?.customer_id)) ? {status: 'verified', scope: scope(ids), record: invoiceRecord(mode, i)} : {status: 'mismatch'};
          }
          if (UUID.test(reference)) {
            const s = (await get<{subscription?: Subscription}>('subscriptions.get', {subscription_id: reference})).subscription;
            if (s?.id !== reference) return {status: 'not_found'};
            return emailMatches(email, await emailOf(undefined, s.customer_id)) ? {status: 'verified', scope: scope([[reference, 'subscription']]), record: subscriptionRecord(mode, s)} : {status: 'mismatch'};
          }
          // A bare id is a payment or an order: try the payment first.
          try {
            const p = (await get<{payment?: Payment}>('payments.get', {payment_id: reference})).payment;
            if (p?.id !== reference) return {status: 'not_found'};
            const ids: [string, RecordKind][] = [[reference, 'payment']];
            if (p.order_id) ids.push([p.order_id, 'order']);
            return emailMatches(email, await emailOf(p.buyer_email_address, p.customer_id)) ? {status: 'verified', scope: scope(ids), record: paymentRecord(mode, p)} : {status: 'mismatch'};
          } catch (e) { if (!notFound(e)) throw e; }
          const o = (await get<{order?: Order}>('orders.get', {order_id: reference})).order;
          if (o?.id !== reference) return {status: 'not_found'};
          return emailMatches(email, await emailOf(undefined, o.customer_id)) ? {status: 'verified', scope: scope([[reference, 'order']]), record: orderRecord(mode, o)} : {status: 'mismatch'};
        } catch (e) {
          if (notFound(e)) return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const ids = s.recordIds.slice(0, 5);
        const of = (k: RecordKind) => ids.filter((i) => s.recordKinds[i] === k);
        switch (intent) {
          case 'order_status': {
            const out: BillingRecord[] = [];
            for (const id of ids) {
              const k = s.recordKinds[id];
              if (k === 'payment') { const p = (await get<{payment?: Payment}>('payments.get', {payment_id: id})).payment; if (p) out.push(paymentRecord(mode, p)); }
              else if (k === 'order') { const o = (await get<{order?: Order}>('orders.get', {order_id: id})).order; if (o) out.push(orderRecord(mode, o)); }
              else if (k === 'invoice') { const i = (await get<{invoice?: Invoice}>('invoices.get', {invoice_id: id})).invoice; if (i) out.push(invoiceRecord(mode, i)); }
              else if (k === 'subscription') { const x = (await get<{subscription?: Subscription}>('subscriptions.get', {subscription_id: id})).subscription; if (x) out.push(subscriptionRecord(mode, x)); }
            }
            return out;
          }
          case 'payment_history': return (await payments(s)).map((p) => paymentRecord(mode, p));
          case 'failed_payment': return (await payments(s)).map((p) => paymentRecord(mode, p)).filter((r) => r.failure);
          case 'invoice': { const out: BillingRecord[] = []; for (const id of of('invoice')) { const i = (await get<{invoice?: Invoice}>('invoices.get', {invoice_id: id})).invoice; if (i) out.push(invoiceRecord(mode, i)); } return out; }
          case 'renewal': { const out: BillingRecord[] = []; for (const id of of('subscription')) { const x = (await get<{subscription?: Subscription}>('subscriptions.get', {subscription_id: id})).subscription; if (x) out.push(subscriptionRecord(mode, x)); } return out.filter((r) => r.renewalAt); }
          case 'refund_status': {
            const out: BillingRecord[] = [];
            for (const p of (await payments(s)).filter((x) => x.refund_ids?.length)) {
              const r = paymentRecord(mode, p);
              for (const rid of (p.refund_ids ?? []).slice(0, 5)) {
                const f = (await get<{refund?: Refund}>('refunds.get', {refund_id: rid})).refund;
                if (f && f.payment_id === p.id) r.refunds.push({id: f.id ?? rid, status: f.status ?? 'unknown', ...money(f.amount_money), createdAt: isoTime(f.created_at)});
              }
              out.push(r);
            }
            return out;
          }
        }
      },
    };
  },
};
