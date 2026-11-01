import {createHash} from 'node:crypto';
import operations from '../../../fixtures/billing-specs/paypal/operations.json';
import {providerClient} from '../core/http';
import {isoTime, toMinor, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// PayPal REST (spec: paypal/paypal-rest-api-specifications @ 90e8041ffe02, Apache-2.0).
// Client-credentials OAuth is the single allowlisted POST; everything else is GET.
type Money = {currency_code?: string; value?: string};
type Capture = {id?: string; status?: string; amount?: Money; create_time?: string; status_details?: {reason?: string}};
type Refund = {id?: string; status?: string; amount?: Money; create_time?: string};
type Order = {id?: string; status?: string; create_time?: string; payer?: {email_address?: string; payer_id?: string}; purchase_units?: {amount?: Money; payments?: {captures?: Capture[]; refunds?: Refund[]}}[]};
type Invoice = {id?: string; status?: string; detail?: {invoice_number?: string; invoice_date?: string; currency_code?: string; metadata?: {create_time?: string; recipient_view_url?: string}}; amount?: Money; primary_recipients?: {billing_info?: {email_address?: string}}[]; payments?: {transactions?: {payment_id?: string; payment_date?: string; amount?: Money}[]}; refunds?: {transactions?: {refund_id?: string; refund_date?: string; amount?: Money}[]}};
type Subscription = {id?: string; status?: string; create_time?: string; subscriber?: {email_address?: string; payer_id?: string}; billing_info?: {next_billing_time?: string; failed_payments_count?: number; last_payment?: {amount?: Money; time?: string}; last_failed_payment?: {amount?: Money; time?: string; reason_code?: string; next_payment_retry_time?: string}}};
type Txn = {id?: string; status?: string; time?: string; amount_with_breakdown?: {gross_amount?: Money}};

const OPS = operations as OperationSpec[];
const ID = /^[A-Za-z0-9_-]{20,128}$/;
const TOKENS = new Map<string, {token: string; until: number}>();
const tokenKey = (clientId: string, mode: BillingMode, base: string) => createHash('sha256').update(`${clientId}|${mode}|${base}`).digest('hex');
const money = (m?: Money) => ({amountMinor: toMinor(m?.value, m?.currency_code), currency: upperCurrency(m?.currency_code)});
const reason = (s?: string) => (s ? s.toLowerCase().replace(/_/g, ' ') : null);

function base(mode: BillingMode, kind: RecordKind, id: string): BillingRecord {
  return {provider: 'paypal', mode, kind, id, displayRef: id, status: 'UNKNOWN', amountMinor: null, currency: null, createdAt: null, hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
function orderRecord(mode: BillingMode, o: Order): BillingRecord {
  const refunds = (o.purchase_units ?? []).flatMap((u) => u.payments?.refunds ?? []).map((r) => ({id: r.id ?? '', status: r.status ?? 'UNKNOWN', ...money(r.amount), createdAt: isoTime(r.create_time)}));
  return {...base(mode, 'order', o.id ?? ''), status: o.status ?? 'UNKNOWN', ...money(o.purchase_units?.[0]?.amount), createdAt: isoTime(o.create_time), refunds, customerRef: o.payer?.payer_id ?? null};
}
function captureRecords(mode: BillingMode, o: Order): BillingRecord[] {
  return (o.purchase_units ?? []).flatMap((u) => u.payments?.captures ?? []).map((c) => captureRecord(mode, c, o.id ?? null));
}
function captureRecord(mode: BillingMode, c: Capture, parent: string | null): BillingRecord {
  const failed = c.status === 'DECLINED' || c.status === 'FAILED';
  return {...base(mode, 'payment', c.id ?? ''), status: c.status ?? 'UNKNOWN', ...money(c.amount), createdAt: isoTime(c.create_time), parentRef: parent, failure: failed ? {message: reason(c.status_details?.reason) ?? 'payment declined', attemptCount: null, nextRetryAt: null} : null};
}
function invoiceRecord(mode: BillingMode, i: Invoice): BillingRecord {
  const refunds = (i.refunds?.transactions ?? []).map((r) => ({id: r.refund_id ?? '', status: 'RECORDED', ...money(r.amount), createdAt: isoTime(r.refund_date)}));
  return {...base(mode, 'invoice', i.id ?? ''), displayRef: i.detail?.invoice_number ?? i.id ?? '', status: i.status ?? 'UNKNOWN', ...money(i.amount), createdAt: isoTime(i.detail?.metadata?.create_time ?? i.detail?.invoice_date), hostedUrl: i.detail?.metadata?.recipient_view_url ?? null, refunds};
}
function invoicePayments(mode: BillingMode, i: Invoice): BillingRecord[] {
  return (i.payments?.transactions ?? []).map((t) => ({...base(mode, 'payment', t.payment_id ?? ''), status: 'COMPLETED', ...money(t.amount), createdAt: isoTime(t.payment_date), parentRef: i.id ?? null}));
}
function subscriptionRecord(mode: BillingMode, s: Subscription): BillingRecord {
  const b = s.billing_info ?? {};
  const failed = b.last_failed_payment;
  const count = typeof b.failed_payments_count === 'number' ? b.failed_payments_count : null;
  return {
    ...base(mode, 'subscription', s.id ?? ''), status: s.status ?? 'UNKNOWN', ...money(b.last_payment?.amount), createdAt: isoTime(s.create_time),
    renewalAt: isoTime(b.next_billing_time), customerRef: s.subscriber?.payer_id ?? null,
    failure: failed || (count ?? 0) > 0 ? {message: reason(failed?.reason_code), attemptCount: count, nextRetryAt: isoTime(failed?.next_payment_retry_time)} : null,
  };
}
function txnRecord(mode: BillingMode, t: Txn, parent: string): BillingRecord {
  return {...base(mode, 'transaction', t.id ?? ''), status: t.status ?? 'UNKNOWN', ...money(t.amount_with_breakdown?.gross_amount), createdAt: isoTime(t.time), parentRef: parent};
}

const cap = (operations: string[]) => ({supported: true, operations});
export const definition: ProviderDefinition = {
  id: 'paypal',
  label: 'PayPal',
  tier: 'A',
  source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://api-m.sandbox.paypal.com'}, live: {baseUrl: 'https://api-m.paypal.com'}},
  credentialFields: [{name: 'clientId', label: 'Client ID', secret: false, placeholder: 'REST app client ID'}, {name: 'clientSecret', label: 'Client secret', secret: true}],
  validateCredential(mode, cred) {
    if (!ID.test(cred.clientId ?? '') || !ID.test(cred.clientSecret ?? '')) return {ok: false, code: 'invalid_credential', message: 'Enter the REST app client ID and secret (20-128 letters, digits, - or _).'};
    return {ok: true, keyHint: `${cred.clientId.slice(0, 4)}…${cred.clientId.slice(-4)}`, ...(mode === 'live' ? {warning: 'PayPal client credentials cannot be restricted to read-only; AutomatePal only calls the read endpoints listed for this connection.'} : {})};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['orders.get', 'invoices.get', 'subscriptions.get']),
    payment_history: cap(['orders.get', 'invoices.get', 'subscriptions.transactions']),
    failed_payment: cap(['orders.get', 'captures.get', 'subscriptions.get']),
    invoice: cap(['invoices.get', 'invoices.list']),
    renewal: cap(['subscriptions.get']),
    refund_status: cap(['orders.get', 'refunds.get', 'invoices.get', 'subscriptions.transactions']),
  },
  referencePatterns: [
    {kind: 'invoice', pattern: /^INV2(-[A-Z0-9]{4}){4}$/i, label: 'Invoice ID (INV2-…)'},
    {kind: 'subscription', pattern: /^I-[A-Z0-9]{10,20}$/i, label: 'Subscription ID (I-…)'},
    {kind: 'order', pattern: /^[A-Z0-9]{17}$/i, label: 'Order ID'},
    {kind: 'invoice_number', pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,24}$/, label: 'Invoice number'},
  ],
  hostedHosts: {test: ['www.sandbox.paypal.com'], live: ['www.paypal.com']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const auth = async (): Promise<Record<string, string>> => {
      const key = tokenKey(cred.clientId, mode, client.baseUrl);
      const hit = TOKENS.get(key);
      if (hit && hit.until > deps.now()) return {Authorization: `Bearer ${hit.token}`};
      const basic = Buffer.from(`${cred.clientId}:${cred.clientSecret}`).toString('base64');
      const t = await client.exchange<{access_token?: string; expires_in?: number}>('oauth.token', {Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded'}, 'grant_type=client_credentials');
      if (!t?.access_token) throw new BillingError('auth_failed');
      if (TOKENS.size >= 100) TOKENS.delete(TOKENS.keys().next().value as string);
      TOKENS.set(key, {token: t.access_token, until: deps.now() + Math.max(0, (t.expires_in ?? 0) - 30) * 1000});
      return {Authorization: `Bearer ${t.access_token}`};
    };
    const client = providerClient(definition, mode, deps, auth);
    const get = client.get;

    const scopeFor = (id: string, kind: RecordKind, customer: string | null): BillingScope => ({provider: 'paypal', mode, customerId: customer, recordIds: [id], recordKinds: {[id]: kind}});
    async function invoiceByNumber(n: string): Promise<Invoice | null> {
      const list = await get<{items?: Invoice[]}>('invoices.list', {}, {page: 1, page_size: 100});
      return (list?.items ?? []).find((i) => i.detail?.invoice_number === n) ?? null;
    }
    const verified = (ok: boolean, scope: BillingScope, record: BillingRecord) => (ok ? {status: 'verified' as const, scope, record} : {status: 'mismatch' as const});

    return {
      async testConnection() {
        try {
          await get('invoices.list', {}, {page: 1, page_size: 1});
          return {ok: true};
        } catch (e) {
          // 403 means the key works but the REST app lacks the Invoicing feature: confirm the key with
          // a subscriptions read instead and say which lookups will be unavailable.
          if (!(e instanceof BillingError && e.code === 'auth_failed' && e.httpStatus === 403)) throw e;
          await get('plans.list', {}, {page_size: 1, page: 1});
          return {ok: true, warning: 'This PayPal app does not have Invoicing enabled, so invoice lookups will fail until it is turned on in the PayPal developer dashboard.'};
        }
      },
      async verifyCustomer(reference, email) {
        const ref = reference.trim();
        const up = ref.toUpperCase();
        try {
          if (/^INV2(-[A-Z0-9]{4}){4}$/.test(up)) {
            const i = await get<Invoice>('invoices.get', {invoice_id: up});
            if (i.id?.toUpperCase() !== up) return {status: 'not_found'};
            return verified(emailMatches(email, i.primary_recipients?.[0]?.billing_info?.email_address), scopeFor(i.id, 'invoice', null), invoiceRecord(mode, i));
          }
          if (/^I-[A-Z0-9]{10,20}$/.test(up)) {
            const s = await get<Subscription>('subscriptions.get', {id: up});
            if (s.id?.toUpperCase() !== up) return {status: 'not_found'};
            return verified(emailMatches(email, s.subscriber?.email_address), scopeFor(s.id, 'subscription', null), subscriptionRecord(mode, s));
          }
          if (/^[A-Z0-9]{17}$/.test(up)) {
            try {
              const o = await get<Order>('orders.get', {id: up});
              // A response for a different record than the one asked for is treated as not found.
              if (o.id?.toUpperCase() !== up) return {status: 'not_found'};
              return verified(emailMatches(email, o.payer?.email_address), scopeFor(o.id, 'order', null), orderRecord(mode, o));
            } catch (e) { if (!(e instanceof BillingError && e.code === 'not_found')) throw e; }
          }
          const i = await invoiceByNumber(ref);
          if (!i?.id) return {status: 'not_found'};
          return verified(emailMatches(email, i.primary_recipients?.[0]?.billing_info?.email_address), scopeFor(i.id, 'invoice', null), invoiceRecord(mode, i));
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(scope, intent: BillingIntent) {
        const out: BillingRecord[] = [];
        for (const id of scope.recordIds.slice(0, 5)) {
          const kind = scope.recordKinds[id];
          if (kind === 'order') {
            const o = await get<Order>('orders.get', {id});
            if (intent === 'order_status') out.push(orderRecord(mode, o), ...captureRecords(mode, o));
            else if (intent === 'payment_history') out.push(...captureRecords(mode, o));
            else if (intent === 'refund_status') {
              const r = orderRecord(mode, o);
              r.refunds = await Promise.all(r.refunds.map(async (f) => {
                const fresh = await get<Refund>('refunds.get', {refund_id: f.id});
                return {id: fresh.id ?? f.id, status: fresh.status ?? f.status, ...money(fresh.amount), createdAt: isoTime(fresh.create_time) ?? f.createdAt};
              }));
              out.push(r);
            } else if (intent === 'failed_payment') {
              for (const c of captureRecords(mode, o).filter((c) => c.failure)) {
                const fresh = await get<Capture>('captures.get', {capture_id: c.id});
                out.push(captureRecord(mode, fresh, o.id ?? null));
              }
            }
          } else if (kind === 'invoice') {
            if (intent === 'renewal' || intent === 'failed_payment') continue;
            const i = await get<Invoice>('invoices.get', {invoice_id: id});
            if (intent === 'payment_history') out.push(...invoicePayments(mode, i));
            else out.push(invoiceRecord(mode, i));
          } else if (kind === 'subscription') {
            if (intent === 'invoice') continue;
            if (intent === 'payment_history' || intent === 'refund_status') {
              const end = new Date(deps.now());
              const start = new Date(deps.now() - 365 * 86400_000);
              const t = await get<{transactions?: Txn[]}>('subscriptions.transactions', {id}, {start_time: start.toISOString(), end_time: end.toISOString()});
              const txns = (t?.transactions ?? []).map((x) => txnRecord(mode, x, id));
              out.push(...(intent === 'refund_status' ? txns.filter((x) => /REFUND/.test(x.status)) : txns));
            } else {
              const s = await get<Subscription>('subscriptions.get', {id});
              const r = subscriptionRecord(mode, s);
              if (intent !== 'failed_payment' || r.failure) out.push(r);
            }
          }
        }
        return out;
      },
    };
  },
};
