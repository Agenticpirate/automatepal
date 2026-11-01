import operations from '../../../fixtures/billing-specs/mollie/operations.json';
import {providerClient} from '../core/http';
import {isoTime, toMinor, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Mollie API v2. The upstream spec (mollie/openapi @ 84b4900bc0d6) has no license file, so only our
// own digest (names, types, required fields) is stored in fixtures/billing-specs/mollie/contract.json.
type Amount = {currency?: string; value?: string};
type Payment = {id?: string; mode?: string; status?: string; amount?: Amount; amountRefunded?: Amount; createdAt?: string; customerId?: string | null; subscriptionId?: string | null; billingAddress?: {email?: string} | null; failedAt?: string | null; details?: {failureReason?: string; failureMessage?: string} | null; _links?: {checkout?: {href?: string}}};
type Customer = {id?: string; email?: string | null};
type Subscription = {id?: string; status?: string; amount?: Amount; customerId?: string; createdAt?: string; nextPaymentDate?: string | null};
type Refund = {id?: string; status?: string; amount?: Amount; createdAt?: string; paymentId?: string};
type Hal<K extends string, T> = {_embedded?: Partial<Record<K, T[]>>};

const OPS = operations as OperationSpec[];
const cap = (ops: string[]) => ({supported: true, operations: ops});
const money = (a?: Amount) => ({amountMinor: toMinor(a?.value, a?.currency), currency: upperCurrency(a?.currency)});
function base(mode: BillingMode, kind: RecordKind, id: string, created?: string): BillingRecord {
  return {provider: 'mollie', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const paymentRecord = (mode: BillingMode, p: Payment): BillingRecord => ({
  ...base(mode, 'payment', p.id ?? '', p.createdAt), status: p.status ?? 'unknown', ...money(p.amount), customerRef: p.customerId ?? null, parentRef: p.subscriptionId ?? null,
  // A checkout link is shown only while the payment can still be completed.
  hostedUrl: p.status === 'open' ? p._links?.checkout?.href ?? null : null,
  failure: p.status === 'failed' || p.status === 'expired' || p.status === 'canceled' ? {message: p.details?.failureMessage ?? p.details?.failureReason?.replace(/_/g, ' ') ?? `payment ${p.status}`, attemptCount: null, nextRetryAt: null} : null,
});
const subscriptionRecord = (mode: BillingMode, s: Subscription): BillingRecord => ({...base(mode, 'subscription', s.id ?? '', s.createdAt), status: s.status ?? 'unknown', ...money(s.amount), renewalAt: s.status === 'active' && s.nextPaymentDate ? isoTime(s.nextPaymentDate + 'T00:00:00Z') : null, customerRef: s.customerId ?? null,
  failure: s.status === 'suspended' ? {message: 'subscription suspended after failed payments', attemptCount: null, nextRetryAt: null} : null});

export const definition: ProviderDefinition = {
  id: 'mollie',
  label: 'Mollie',
  tier: 'B',
  source: {confidence: 'official-spec'},
  // One host; the key prefix (test_ / live_) is the mode.
  modes: {test: {baseUrl: 'https://api.mollie.com'}, live: {baseUrl: 'https://api.mollie.com'}},
  credentialFields: [{name: 'apiKey', label: 'API key', secret: true, placeholder: 'test_…'}],
  validateCredential(mode, cred) {
    const k = (cred.apiKey ?? '').trim();
    if (/^access_/.test(k)) return {ok: false, code: 'refused_key', message: 'Organization access tokens are refused. Use the website profile API key (test_… or live_…).'};
    if (!/^(test|live)_[A-Za-z0-9]{20,64}$/.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter a Mollie API key (test_… or live_…).'};
    if (!k.startsWith(mode + '_')) return {ok: false, code: 'mode_mismatch', message: `That is a ${mode === 'live' ? 'test' : 'live'} key. Choose the matching mode.`};
    return {ok: true, keyHint: `${k.slice(0, 7)}…${k.slice(-4)}`, warning: 'Mollie API keys are not read-only; AutomatePal only calls the read endpoints listed for this connection.'};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['payments.get']),
    payment_history: cap(['customers.payments']),
    failed_payment: cap(['customers.payments', 'customers.subscriptions']),
    // Mollie's payment objects carry no invoice; the Invoices API is Mollie's own bill to the merchant.
    invoice: {supported: false, operations: []},
    renewal: cap(['customers.subscriptions', 'customers.subscription']),
    refund_status: cap(['payments.get', 'customers.payments', 'payments.refunds']),
  },
  referencePatterns: [{kind: 'payment', pattern: /^tr_[A-Za-z0-9]{6,32}$/, label: 'Payment ID (tr_…)'}],
  hostedHosts: {test: ['www.mollie.com'], live: ['www.mollie.com']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Bearer ${cred.apiKey}`}));
    const customerPayments = async (s: BillingScope) => s.customerId ? ((await get<Hal<'payments', Payment>>('customers.payments', {customerId: s.customerId}, {limit: 10}))._embedded?.payments ?? []).filter((p) => p.customerId === s.customerId) : [];
    const subs = async (s: BillingScope) => {
      if (s.customerId) return ((await get<Hal<'subscriptions', Subscription>>('customers.subscriptions', {customerId: s.customerId}, {limit: 10}))._embedded?.subscriptions ?? []).filter((x) => x.customerId === s.customerId);
      return [];
    };
    return {
      async testConnection() {
        const list = await get<Hal<'payments', Payment>>('payments.list', {}, {limit: 1});
        const first = list._embedded?.payments?.[0];
        if (first?.mode && first.mode !== mode) throw new BillingError('mode_mismatch', {publicMessage: `That key reads ${first.mode} data, but ${mode === 'live' ? 'LIVE' : 'Test'} mode was selected.`});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          const p = await get<Payment>('payments.get', {paymentId: reference});
          if (p.id !== reference) return {status: 'not_found'};
          const onRecord = p.billingAddress?.email || (p.customerId ? (await get<Customer>('customers.get', {customerId: p.customerId})).email : null);
          if (!emailMatches(email, onRecord)) return {status: 'mismatch'};
          return {status: 'verified', scope: {provider: 'mollie', mode, customerId: p.customerId ?? null, recordIds: [reference], recordKinds: {[reference]: 'payment'}}, record: paymentRecord(mode, p)};
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        const own = async () => { const out: Payment[] = []; for (const id of s.recordIds.slice(0, 5)) out.push(await get<Payment>('payments.get', {paymentId: id})); return out; };
        switch (intent) {
          case 'order_status': return (await own()).map((p) => paymentRecord(mode, p));
          case 'payment_history': return (s.customerId ? await customerPayments(s) : await own()).map((p) => paymentRecord(mode, p));
          case 'failed_payment': return [...(await subs(s)).map((x) => subscriptionRecord(mode, x)).filter((r) => r.failure), ...(await customerPayments(s)).map((p) => paymentRecord(mode, p)).filter((r) => r.failure)];
          case 'invoice': return [];
          case 'renewal': return (await subs(s)).map((x) => subscriptionRecord(mode, x)).filter((r) => r.renewalAt);
          case 'refund_status': {
            const out: BillingRecord[] = [];
            for (const p of (s.customerId ? await customerPayments(s) : await own()).filter((x) => (toMinor(x.amountRefunded?.value, x.amountRefunded?.currency) ?? 0) > 0).slice(0, 5)) {
              const r = paymentRecord(mode, p);
              r.refunds = ((await get<Hal<'refunds', Refund>>('payments.refunds', {paymentId: r.id}, {limit: 10}))._embedded?.refunds ?? []).filter((f) => f.paymentId === r.id).map((f) => ({id: f.id ?? '', status: f.status ?? 'unknown', ...money(f.amount), createdAt: isoTime(f.createdAt)}));
              out.push(r);
            }
            return out;
          }
        }
      },
    };
  },
};
