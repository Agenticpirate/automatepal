import operations from '../../../fixtures/billing-specs/razorpay/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Razorpay REST, docs-derived contract (razorpay.com/docs/api; no official OpenAPI found).
// Basic auth key_id:key_secret. One host; the key prefix (rzp_test_ / rzp_live_) is the mode.
type Payment = {id?: string; status?: string; amount?: number; currency?: string; created_at?: number; order_id?: string | null; invoice_id?: string | null; email?: string | null; amount_refunded?: number; refund_status?: string | null; error_description?: string | null};
type Order = {id?: string; status?: string; amount?: number; currency?: string; created_at?: number; receipt?: string | null};
type Invoice = {id?: string; status?: string; amount?: number; currency?: string; created_at?: number; invoice_number?: string | null; receipt?: string | null; customer_id?: string | null; customer_details?: {email?: string | null}; order_id?: string | null; payment_id?: string | null; short_url?: string | null};
type Subscription = {id?: string; status?: string; created_at?: number; customer_id?: string | null; charge_at?: number | null; current_end?: number | null; auth_attempts?: number; short_url?: string | null};
type Refund = {id?: string; status?: string; amount?: number; currency?: string; created_at?: number};
type Collection<T> = {items?: T[]};

const OPS = operations as OperationSpec[];
const cap = (ops: string[]) => ({supported: true, operations: ops});
const ID = (p: string) => new RegExp(`^${p}_[A-Za-z0-9]{10,20}$`);
function base(mode: BillingMode, kind: RecordKind, id: string, created?: number): BillingRecord {
  return {provider: 'razorpay', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const paymentRecord = (mode: BillingMode, p: Payment): BillingRecord => ({
  ...base(mode, 'payment', p.id ?? '', p.created_at), status: p.status ?? 'unknown', amountMinor: p.amount ?? null, currency: upperCurrency(p.currency), parentRef: p.order_id ?? null,
  failure: p.status === 'failed' ? {message: p.error_description ?? 'payment failed', attemptCount: null, nextRetryAt: null} : null,
});
const orderRecord = (mode: BillingMode, o: Order): BillingRecord => ({...base(mode, 'order', o.id ?? '', o.created_at), displayRef: o.receipt || o.id || '', status: o.status ?? 'unknown', amountMinor: o.amount ?? null, currency: upperCurrency(o.currency)});
const invoiceRecord = (mode: BillingMode, i: Invoice): BillingRecord => ({...base(mode, 'invoice', i.id ?? '', i.created_at), displayRef: i.invoice_number || i.receipt || i.id || '', status: i.status ?? 'unknown', amountMinor: i.amount ?? null, currency: upperCurrency(i.currency), hostedUrl: i.short_url ?? null, parentRef: i.order_id ?? null});
function subscriptionRecord(mode: BillingMode, s: Subscription): BillingRecord {
  const retrying = s.status === 'pending' || s.status === 'halted';
  return {...base(mode, 'subscription', s.id ?? '', s.created_at), status: s.status ?? 'unknown', renewalAt: isoTime(s.charge_at ?? s.current_end ?? undefined), hostedUrl: s.short_url ?? null,
    failure: retrying ? {message: s.status === 'halted' ? 'payment retries exhausted' : 'payment failed, retrying', attemptCount: s.auth_attempts ?? null, nextRetryAt: s.status === 'pending' ? isoTime(s.charge_at ?? undefined) : null} : null};
}

export const definition: ProviderDefinition = {
  id: 'razorpay',
  label: 'Razorpay',
  tier: 'A',
  source: {confidence: 'docs-derived'},
  modes: {test: {baseUrl: 'https://api.razorpay.com'}, live: {baseUrl: 'https://api.razorpay.com'}},
  credentialFields: [{name: 'keyId', label: 'Key ID', secret: false, placeholder: 'rzp_test_…'}, {name: 'keySecret', label: 'Key secret', secret: true}],
  validateCredential(mode, cred) {
    const id = (cred.keyId ?? '').trim(), secret = (cred.keySecret ?? '').trim();
    if (!/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(id) || !/^[A-Za-z0-9]{12,64}$/.test(secret)) return {ok: false, code: 'invalid_credential', message: 'Enter the Razorpay key ID (rzp_test_… or rzp_live_…) and its secret.'};
    if (!id.startsWith(`rzp_${mode}_`)) return {ok: false, code: 'mode_mismatch', message: `That key is for ${mode === 'live' ? 'test' : 'live'} mode. Choose the matching mode.`};
    return {ok: true, keyHint: `${id.slice(0, 9)}…${id.slice(-4)}`, warning: 'Razorpay API keys are not read-only; AutomatePal only calls the read endpoints listed for this connection.'};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['payments.get', 'orders.get', 'invoices.get', 'subscriptions.get']),
    payment_history: cap(['payments.get', 'orders.payments']),
    failed_payment: cap(['orders.payments', 'payments.get', 'subscriptions.get']),
    invoice: cap(['invoices.get']),
    renewal: cap(['subscriptions.get']),
    refund_status: cap(['payments.get', 'orders.payments', 'payments.refunds']),
  },
  referencePatterns: [
    {kind: 'payment', pattern: ID('pay'), label: 'Payment ID (pay_…)'},
    {kind: 'order', pattern: ID('order'), label: 'Order ID (order_…)'},
    {kind: 'invoice', pattern: ID('inv'), label: 'Invoice ID (inv_…)'},
    {kind: 'subscription', pattern: ID('sub'), label: 'Subscription ID (sub_…)'},
  ],
  hostedHosts: {test: ['rzp.io'], live: ['rzp.io']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const basic = Buffer.from(`${cred.keyId}:${cred.keySecret}`).toString('base64');
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Basic ${basic}`}));
    const scope = (ids: [string, RecordKind][]): BillingScope => ({provider: 'razorpay', mode, customerId: null, recordIds: ids.map(([i]) => i), recordKinds: Object.fromEntries(ids)});
    const kindOf = (ref: string): RecordKind | null => (/^pay_/.test(ref) ? 'payment' : /^order_/.test(ref) ? 'order' : /^inv_/.test(ref) ? 'invoice' : /^sub_/.test(ref) ? 'subscription' : null);
    // Payments in scope: the verified payment, or every payment of a verified order.
    async function payments(s: BillingScope): Promise<Payment[]> {
      const out: Payment[] = [];
      for (const id of s.recordIds.slice(0, 5)) {
        const k = s.recordKinds[id];
        if (k === 'order') out.push(...((await get<Collection<Payment>>('orders.payments', {id})).items ?? []).filter((p) => p.order_id === id));
        else if (k === 'payment' && !out.some((p) => p.id === id)) out.push(await get<Payment>('payments.get', {id}));
      }
      return out;
    }
    return {
      async testConnection() {
        await get('payments.list', {}, {count: 1});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        const kind = kindOf(reference);
        if (!kind) return {status: 'not_found'};
        try {
          if (kind === 'payment') {
            const p = await get<Payment>('payments.get', {id: reference});
            if (p.id !== reference) return {status: 'not_found'};
            const ids: [string, RecordKind][] = [[reference, 'payment']];
            if (p.order_id) ids.push([p.order_id, 'order']);
            return emailMatches(email, p.email) ? {status: 'verified', scope: scope(ids), record: paymentRecord(mode, p)} : {status: 'mismatch'};
          }
          if (kind === 'order') {
            const o = await get<Order>('orders.get', {id: reference});
            if (o.id !== reference) return {status: 'not_found'};
            const ps = ((await get<Collection<Payment>>('orders.payments', {id: reference})).items ?? []).filter((p) => p.order_id === reference);
            return ps.some((p) => emailMatches(email, p.email)) ? {status: 'verified', scope: scope([[reference, 'order']]), record: orderRecord(mode, o)} : {status: 'mismatch'};
          }
          if (kind === 'invoice') {
            const i = await get<Invoice>('invoices.get', {id: reference});
            if (i.id !== reference) return {status: 'not_found'};
            const ids: [string, RecordKind][] = [[reference, 'invoice']];
            if (i.payment_id) ids.push([i.payment_id, 'payment']);
            return emailMatches(email, i.customer_details?.email) ? {status: 'verified', scope: scope(ids), record: invoiceRecord(mode, i)} : {status: 'mismatch'};
          }
          const sub = await get<Subscription>('subscriptions.get', {id: reference});
          if (sub.id !== reference) return {status: 'not_found'};
          const customer = sub.customer_id ? await get<{email?: string | null}>('customers.get', {id: sub.customer_id}) : null;
          return emailMatches(email, customer?.email) ? {status: 'verified', scope: scope([[reference, 'subscription']]), record: subscriptionRecord(mode, sub)} : {status: 'mismatch'};
        } catch (e) {
          // Razorpay answers an unknown id with 400 BAD_REQUEST_ERROR rather than 404.
          if (e instanceof BillingError && (e.code === 'not_found' || (e.code === 'provider_error' && e.httpStatus === 400))) return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const ids = s.recordIds.slice(0, 5);
        const subs = async () => { const out: BillingRecord[] = []; for (const id of ids.filter((i) => s.recordKinds[i] === 'subscription')) out.push(subscriptionRecord(mode, await get<Subscription>('subscriptions.get', {id}))); return out; };
        switch (intent) {
          case 'order_status': {
            const out: BillingRecord[] = [];
            for (const id of ids) {
              const k = s.recordKinds[id];
              if (k === 'payment') out.push(paymentRecord(mode, await get<Payment>('payments.get', {id})));
              else if (k === 'order') out.push(orderRecord(mode, await get<Order>('orders.get', {id})));
              else if (k === 'invoice') out.push(invoiceRecord(mode, await get<Invoice>('invoices.get', {id})));
            }
            return [...out, ...(await subs())];
          }
          case 'payment_history': return (await payments(s)).map((p) => paymentRecord(mode, p));
          case 'failed_payment': return [...(await payments(s)).filter((p) => p.status === 'failed').map((p) => paymentRecord(mode, p)), ...(await subs()).filter((r) => r.failure)];
          case 'invoice': { const out: BillingRecord[] = []; for (const id of ids.filter((i) => s.recordKinds[i] === 'invoice')) out.push(invoiceRecord(mode, await get<Invoice>('invoices.get', {id}))); return out; }
          case 'renewal': return (await subs()).filter((r) => r.renewalAt);
          case 'refund_status': {
            const out: BillingRecord[] = [];
            for (const p of (await payments(s)).filter((x) => (x.amount_refunded ?? 0) > 0 || x.refund_status)) {
              const r = paymentRecord(mode, p);
              r.refunds = ((await get<Collection<Refund>>('payments.refunds', {id: p.id ?? ''}, {count: 10})).items ?? []).map((f) => ({id: f.id ?? '', status: f.status ?? 'unknown', amountMinor: f.amount ?? null, currency: upperCurrency(f.currency), createdAt: isoTime(f.created_at)}));
              out.push(r);
            }
            return out;
          }
        }
      },
    };
  },
};
