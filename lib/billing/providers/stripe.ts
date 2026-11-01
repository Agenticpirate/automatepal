import operations from '../../../fixtures/billing-specs/stripe/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Stripe REST (spec: stripe/openapi @ 51610f5f061c, MIT). Plain fetch, Bearer key, GET only.
// Stripe-Version is pinned to the vendored spec's info.version so responses match the contract.
export const STRIPE_VERSION = '2026-09-30.endive';
type List<T> = {data?: T[]};
type Ref = string | {id?: string} | null | undefined;
type Charge = {id?: string; status?: string; amount?: number; amount_refunded?: number; currency?: string; created?: number; customer?: Ref; payment_intent?: Ref; receipt_email?: string | null; receipt_url?: string | null; failure_message?: string | null; livemode?: boolean; refunded?: boolean; billing_details?: {email?: string | null}};
type Intent = {id?: string; status?: string; amount?: number; currency?: string; created?: number; customer?: Ref; receipt_email?: string | null; latest_charge?: Ref; last_payment_error?: {message?: string} | null};
type Invoice = {id?: string; number?: string | null; status?: string | null; total?: number; currency?: string; created?: number; customer?: Ref; customer_email?: string | null; hosted_invoice_url?: string | null; attempt_count?: number; next_payment_attempt?: number | null; subscription?: Ref};
type Subscription = {id?: string; status?: string; currency?: string; created?: number; customer?: Ref; current_period_end?: number; items?: {data?: {current_period_end?: number; price?: {unit_amount?: number | null; currency?: string}}[]}};
type Refund = {id?: string; status?: string | null; amount?: number; currency?: string; created?: number; charge?: Ref};
type Customer = {id?: string; email?: string | null; deleted?: boolean};

const OPS = operations as OperationSpec[];
const idOf = (r: Ref) => (typeof r === 'string' ? r : r?.id ?? null);
const KEY = {rk_test: /^rk_test_[A-Za-z0-9]{10,250}$/, sk_test: /^sk_test_[A-Za-z0-9]{10,250}$/, rk_live: /^rk_live_[A-Za-z0-9]{10,250}$/};
const cap = (ops: string[]) => ({supported: true, operations: ops});

function base(mode: BillingMode, kind: RecordKind, id: string, created?: number): BillingRecord {
  return {provider: 'stripe', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const chargeRecord = (mode: BillingMode, c: Charge): BillingRecord => ({
  ...base(mode, 'charge', c.id ?? '', c.created), status: c.status ?? 'unknown', amountMinor: c.amount ?? null, currency: upperCurrency(c.currency), customerRef: idOf(c.customer), parentRef: idOf(c.payment_intent), hostedUrl: c.receipt_url ?? null,
  failure: c.status === 'failed' ? {message: c.failure_message ?? 'payment failed', attemptCount: null, nextRetryAt: null} : null,
});
const intentRecord = (mode: BillingMode, p: Intent): BillingRecord => ({
  ...base(mode, 'payment', p.id ?? '', p.created), status: p.status ?? 'unknown', amountMinor: p.amount ?? null, currency: upperCurrency(p.currency), customerRef: idOf(p.customer),
  failure: p.last_payment_error ? {message: p.last_payment_error.message ?? 'payment failed', attemptCount: null, nextRetryAt: null} : null,
});
const invoiceRecord = (mode: BillingMode, i: Invoice): BillingRecord => ({
  ...base(mode, 'invoice', i.id ?? '', i.created), displayRef: i.number ?? i.id ?? '', status: i.status ?? 'unknown', amountMinor: i.total ?? null, currency: upperCurrency(i.currency), hostedUrl: i.hosted_invoice_url ?? null, customerRef: idOf(i.customer), parentRef: idOf(i.subscription),
  failure: i.status === 'open' && (i.attempt_count ?? 0) > 0 ? {message: 'invoice payment attempt failed', attemptCount: i.attempt_count ?? null, nextRetryAt: isoTime(i.next_payment_attempt ?? undefined)} : null,
});
function subscriptionRecord(mode: BillingMode, s: Subscription): BillingRecord {
  // The pinned API version moved current_period_end onto subscription items; read both.
  const ends = (s.items?.data ?? []).map((x) => x.current_period_end).filter((x): x is number => typeof x === 'number');
  const end = typeof s.current_period_end === 'number' ? s.current_period_end : ends.length ? Math.min(...ends) : undefined;
  const price = s.items?.data?.[0]?.price;
  return {...base(mode, 'subscription', s.id ?? '', s.created), status: s.status ?? 'unknown', amountMinor: price?.unit_amount ?? null, currency: upperCurrency(price?.currency ?? s.currency), renewalAt: isoTime(end), customerRef: idOf(s.customer)};
}

export const definition: ProviderDefinition = {
  id: 'stripe',
  label: 'Stripe',
  tier: 'A',
  source: {confidence: 'official-spec'},
  // One host for both modes; the key prefix decides the mode and the connect check confirms livemode.
  modes: {test: {baseUrl: 'https://api.stripe.com'}, live: {baseUrl: 'https://api.stripe.com'}},
  credentialFields: [{name: 'apiKey', label: 'Restricted key (read permissions)', secret: true, placeholder: 'rk_test_…'}],
  validateCredential(mode, cred) {
    const k = (cred.apiKey ?? '').trim();
    if (/^pk_/.test(k)) return {ok: false, code: 'refused_key', message: 'Publishable keys cannot read payments. Create a restricted key with read permissions.'};
    if (/^sk_live_/.test(k)) return {ok: false, code: 'refused_key', message: 'Full live secret keys are refused. Create a restricted key with read permissions.'};
    const hint = `${k.slice(0, 8)}…${k.slice(-4)}`;
    if (mode === 'test') {
      if (KEY.rk_test.test(k)) return {ok: true, keyHint: hint};
      if (KEY.sk_test.test(k)) return {ok: true, keyHint: hint, warning: 'A full test secret key works, but a restricted key with read permissions is safer.'};
      if (/^(rk|sk)_live_/.test(k)) return {ok: false, code: 'mode_mismatch', message: 'That is a live key. Choose LIVE mode or use an rk_test_ key.'};
    } else {
      if (KEY.rk_live.test(k)) return {ok: true, keyHint: hint};
      if (/^(rk|sk)_test_/.test(k)) return {ok: false, code: 'mode_mismatch', message: 'That is a test key. Choose Test mode or use an rk_live_ restricted key.'};
    }
    return {ok: false, code: 'invalid_credential', message: 'Enter a Stripe restricted key (rk_test_… or rk_live_…).'};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['charges.get', 'payment_intents.get', 'invoices.get']),
    payment_history: cap(['charges.list', 'charges.get']),
    failed_payment: cap(['charges.list', 'invoices.list']),
    invoice: cap(['invoices.get', 'invoices.list', 'invoices.search']),
    renewal: cap(['subscriptions.list']),
    refund_status: cap(['charges.get', 'charges.list', 'refunds.list']),
  },
  referencePatterns: [
    {kind: 'charge', pattern: /^ch_[A-Za-z0-9]{6,64}$/, label: 'Charge ID (ch_…)'},
    {kind: 'payment', pattern: /^pi_[A-Za-z0-9]{6,64}$/, label: 'Payment ID (pi_…)'},
    {kind: 'invoice', pattern: /^in_[A-Za-z0-9]{6,64}$/, label: 'Invoice ID (in_…)'},
    {kind: 'invoice_number', pattern: /^[A-Za-z0-9]{3,20}-[0-9]{3,8}$/, label: 'Invoice number'},
  ],
  hostedHosts: {test: ['invoice.stripe.com', 'pay.stripe.com'], live: ['invoice.stripe.com', 'pay.stripe.com']},
  defaultHeaders: {'Stripe-Version': STRIPE_VERSION},
  createAdapter(cred, mode, deps): BillingAdapter {
    const client = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.apiKey}`}));
    const get = client.get;
    async function emailFor(direct: string | null | undefined, customer: string | null): Promise<string | null> {
      if (direct) return direct;
      if (!customer) return null;
      const c = await get<Customer>('customers.get', {customer});
      return c.deleted ? null : c.email ?? null;
    }
    const scope = (customer: string | null, ids: [string, RecordKind][]): BillingScope => ({provider: 'stripe', mode, customerId: customer, recordIds: ids.map(([i]) => i), recordKinds: Object.fromEntries(ids)});
    const result = async (given: string, direct: string | null | undefined, customer: string | null, ids: [string, RecordKind][], record: BillingRecord) =>
      emailMatches(given, await emailFor(direct, customer)) ? {status: 'verified' as const, scope: scope(customer, ids), record} : {status: 'mismatch' as const};
    async function charges(s: BillingScope): Promise<Charge[]> {
      if (s.customerId) return (await get<List<Charge>>('charges.list', {}, {customer: s.customerId, limit: 10})).data ?? [];
      const out: Charge[] = [];
      for (const id of s.recordIds.filter((i) => s.recordKinds[i] === 'charge').slice(0, 5)) out.push(await get<Charge>('charges.get', {charge: id}));
      return out;
    }
    return {
      async testConnection() {
        const list = await get<List<Charge>>('charges.list', {}, {limit: 1});
        const first = list.data?.[0];
        if (first && typeof first.livemode === 'boolean' && first.livemode !== (mode === 'live')) throw new BillingError('mode_mismatch', {publicMessage: `That key reads ${first.livemode ? 'live' : 'test'} data, but ${mode === 'live' ? 'LIVE' : 'Test'} mode was selected.`});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          if (/^ch_/.test(reference)) {
            const c = await get<Charge>('charges.get', {charge: reference});
            if (c.id !== reference) return {status: 'not_found'};
            return result(email, c.billing_details?.email ?? c.receipt_email, idOf(c.customer), [[reference, 'charge']], chargeRecord(mode, c));
          }
          if (/^pi_/.test(reference)) {
            const p = await get<Intent>('payment_intents.get', {intent: reference});
            if (p.id !== reference) return {status: 'not_found'};
            const ids: [string, RecordKind][] = [[reference, 'payment']];
            const ch = idOf(p.latest_charge);
            if (ch) ids.push([ch, 'charge']);
            return result(email, p.receipt_email, idOf(p.customer), ids, intentRecord(mode, p));
          }
          const inv = /^in_/.test(reference)
            ? await get<Invoice>('invoices.get', {invoice: reference})
            : (await get<List<Invoice>>('invoices.search', {}, {query: `number:"${reference.replace(/"/g, '')}"`})).data?.find((i) => i.number === reference);
          if (!inv?.id || (/^in_/.test(reference) && inv.id !== reference)) return {status: 'not_found'};
          return result(email, inv.customer_email, idOf(inv.customer), [[inv.id, 'invoice']], invoiceRecord(mode, inv));
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const ids = s.recordIds.slice(0, 5);
        switch (intent) {
          case 'order_status': {
            const out: BillingRecord[] = [];
            for (const id of ids) {
              const k = s.recordKinds[id];
              if (k === 'charge') out.push(chargeRecord(mode, await get<Charge>('charges.get', {charge: id})));
              else if (k === 'payment') out.push(intentRecord(mode, await get<Intent>('payment_intents.get', {intent: id})));
              else if (k === 'invoice') out.push(invoiceRecord(mode, await get<Invoice>('invoices.get', {invoice: id})));
            }
            return out;
          }
          case 'payment_history':
            return (await charges(s)).map((c) => chargeRecord(mode, c));
          case 'failed_payment': {
            const failed = (await charges(s)).filter((c) => c.status === 'failed').map((c) => chargeRecord(mode, c));
            const open = s.customerId ? ((await get<List<Invoice>>('invoices.list', {}, {customer: s.customerId, status: 'open', limit: 10})).data ?? []).map((i) => invoiceRecord(mode, i)).filter((r) => r.failure) : [];
            return [...open, ...failed];
          }
          case 'invoice': {
            if (s.customerId) return ((await get<List<Invoice>>('invoices.list', {}, {customer: s.customerId, limit: 10})).data ?? []).map((i) => invoiceRecord(mode, i));
            const out: BillingRecord[] = [];
            for (const id of ids.filter((i) => s.recordKinds[i] === 'invoice')) out.push(invoiceRecord(mode, await get<Invoice>('invoices.get', {invoice: id})));
            return out;
          }
          case 'renewal':
            if (!s.customerId) return [];
            return ((await get<List<Subscription>>('subscriptions.list', {}, {customer: s.customerId, status: 'active', limit: 10})).data ?? []).map((x) => subscriptionRecord(mode, x));
          case 'refund_status': {
            const out: BillingRecord[] = [];
            for (const c of (await charges(s)).filter((x) => (x.amount_refunded ?? 0) > 0 || x.refunded).slice(0, 5)) {
              const r = chargeRecord(mode, c);
              r.refunds = ((await get<List<Refund>>('refunds.list', {}, {charge: c.id ?? '', limit: 10})).data ?? []).map((f) => ({id: f.id ?? '', status: f.status ?? 'unknown', amountMinor: f.amount ?? null, currency: upperCurrency(f.currency), createdAt: isoTime(f.created)}));
              out.push(r);
            }
            return out;
          }
        }
      },
    };
  },
};
