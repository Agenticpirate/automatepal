import operations from '../../../fixtures/billing-specs/chargebee/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingMode, type BillingRecord, type BillingScope, type OperationSpec, type ProviderDefinition, type RecordKind} from '../core/types';

// Chargebee API v2 (spec: chargebee/openapi chargebee_api_v2_pc_v2_spec.json @ 06f6ff8a4dd9, MIT),
// labelled early-access per the user. Basic auth with the API key as username. The host is the
// merchant's site: {site}.chargebee.com for live and {site}-test.chargebee.com for test (spec servers).
type Invoice = {id?: string; customer_id?: string; subscription_id?: string | null; status?: string; date?: number; total?: number; amount_due?: number; currency_code?: string; next_retry_at?: number | null; dunning_attempts?: unknown[]; billing_address?: {email?: string}};
type Sub = {id?: string; customer_id?: string; status?: string; currency_code?: string; created_at?: number; next_billing_at?: number | null; current_term_end?: number | null; due_invoices_count?: number; subscription_items?: {amount?: number}[]};
type Txn = {id?: string; customer_id?: string; subscription_id?: string | null; type?: string; status?: string; date?: number; amount?: number; currency_code?: string; error_text?: string | null};
type Credit = {id?: string; customer_id?: string; reference_invoice_id?: string | null; type?: string; status?: string; date?: number; total?: number; amount_refunded?: number; currency_code?: string};

const OPS = operations as OperationSpec[];
const SITE = /^[a-z0-9-]{2,50}$/;
const cap = (ops: string[]) => ({supported: true, operations: ops});
function base(mode: BillingMode, kind: RecordKind, id: string, created?: number): BillingRecord {
  return {provider: 'chargebee', mode, kind, id, displayRef: id, status: 'unknown', amountMinor: null, currency: null, createdAt: isoTime(created), hostedUrl: null, renewalAt: null, failure: null, refunds: [], customerRef: null, parentRef: null};
}
const invoiceRecord = (mode: BillingMode, i: Invoice): BillingRecord => ({...base(mode, 'invoice', i.id ?? '', i.date), status: i.status ?? 'unknown', amountMinor: i.total ?? null, currency: upperCurrency(i.currency_code), customerRef: i.customer_id ?? null, parentRef: i.subscription_id ?? null,
  failure: i.status === 'payment_due' || i.status === 'not_paid' ? {message: i.status === 'not_paid' ? 'invoice not paid; retries exhausted' : 'invoice payment due', attemptCount: i.dunning_attempts?.length ?? null, nextRetryAt: isoTime(i.next_retry_at ?? undefined)} : null});
const subRecord = (mode: BillingMode, s: Sub): BillingRecord => ({...base(mode, 'subscription', s.id ?? '', s.created_at), status: s.status ?? 'unknown', currency: upperCurrency(s.currency_code), customerRef: s.customer_id ?? null,
  amountMinor: (s.subscription_items ?? []).reduce<number | null>((n, x) => (typeof x.amount === 'number' ? (n ?? 0) + x.amount : n), null),
  renewalAt: s.status === 'active' || s.status === 'in_trial' ? isoTime(s.next_billing_at ?? undefined) : null,
  failure: (s.due_invoices_count ?? 0) > 0 ? {message: 'subscription has unpaid invoices', attemptCount: null, nextRetryAt: null} : null});
const txnRecord = (mode: BillingMode, t: Txn): BillingRecord => ({...base(mode, 'transaction', t.id ?? '', t.date), status: t.status ?? 'unknown', amountMinor: t.amount ?? null, currency: upperCurrency(t.currency_code), customerRef: t.customer_id ?? null, parentRef: t.subscription_id ?? null,
  failure: t.status === 'failure' || t.status === 'late_failure' || t.status === 'timeout' ? {message: t.error_text ?? 'payment failed', attemptCount: null, nextRetryAt: null} : null});

export const definition: ProviderDefinition = {
  id: 'chargebee',
  label: 'Chargebee',
  tier: 'B',
  source: {confidence: 'official-spec-early-access'},
  modes: {test: {baseUrl: 'https://{site}-test.chargebee.com/api/v2'}, live: {baseUrl: 'https://{site}.chargebee.com/api/v2'}},
  baseUrl(_mode, config) {
    const site = (config.site ?? '').trim().toLowerCase();
    if (!SITE.test(site)) throw new BillingError('invalid_credential', {publicMessage: 'Enter your Chargebee site name (the part before .chargebee.com).'});
    return `https://${site}.chargebee.com/api/v2`;
  },
  credentialFields: [{name: 'apiKey', label: 'API key (read-only)', secret: true, placeholder: 'test_… or live_…'}],
  configFields: [{name: 'site', label: 'Site name', placeholder: 'acme-test'}],
  validateCredential(mode, cred, config = {}) {
    const k = (cred.apiKey ?? '').trim(), site = (config.site ?? '').trim().toLowerCase();
    if (!/^[A-Za-z0-9_]{20,120}$/.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter a Chargebee read-only API key.'};
    if (!SITE.test(site)) return {ok: false, code: 'invalid_credential', message: 'Enter your Chargebee site name (letters, digits and -).'};
    // Chargebee test sites are named <site>-test (spec servers); the mode must match the site.
    const testSite = site.endsWith('-test');
    if (mode === 'test' && !testSite) return {ok: false, code: 'mode_mismatch', message: 'Test mode needs your test site (its name ends in -test).'};
    if (mode === 'live' && testSite) return {ok: false, code: 'mode_mismatch', message: 'That is a test site. Choose Test mode or enter the live site name.'};
    return {ok: true, keyHint: `${k.slice(0, 5)}…${k.slice(-4)}`};
  },
  operations: OPS,
  capabilities: {
    order_status: cap(['invoices.get', 'subscriptions.get']),
    payment_history: cap(['transactions.list']),
    failed_payment: cap(['transactions.list', 'invoices.list']),
    invoice: cap(['invoices.get', 'invoices.list']),
    renewal: cap(['subscriptions.get', 'subscriptions.list']),
    refund_status: cap(['credit_notes.list']),
  },
  referencePatterns: [{kind: 'invoice', pattern: /^[A-Za-z0-9_-]{1,50}$/, label: 'Invoice or subscription ID'}],
  hostedHosts: {test: [], live: []},
  createAdapter(cred, mode, deps): BillingAdapter {
    const basic = Buffer.from(`${cred.apiKey}:`).toString('base64');
    const {get} = providerClient(definition, mode, deps, async () => ({Authorization: `Basic ${basic}`}));
    const scope = (customer: string | null, id: string, kind: RecordKind): BillingScope => ({provider: 'chargebee', mode, customerId: customer, recordIds: [id], recordKinds: {[id]: kind}});
    const emailOf = async (customer?: string) => (customer ? (await get<{customer?: {email?: string}}>('customers.get', {'customer-id': customer})).customer?.email ?? null : null);
    const byCustomer = <T extends {customer_id?: string}>(rows: T[], s: BillingScope) => rows.filter((r) => r.customer_id === s.customerId);
    const list = async <K extends string, T extends {customer_id?: string}>(op: string, key: K, s: BillingScope) =>
      s.customerId ? byCustomer(((await get<{list?: Record<K, T>[]}>(op, {}, {'customer_id[is]': s.customerId, limit: 10})).list ?? []).map((x) => x[key]).filter(Boolean), s) : [];
    const notFound = (e: unknown) => e instanceof BillingError && e.code === 'not_found';
    return {
      async testConnection() {
        await get('transactions.list', {}, {limit: 1});
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          try {
            const i = (await get<{invoice?: Invoice}>('invoices.get', {'invoice-id': reference})).invoice;
            if (i?.id !== reference) return {status: 'not_found'};
            return emailMatches(email, i.billing_address?.email || await emailOf(i.customer_id)) ? {status: 'verified', scope: scope(i.customer_id ?? null, reference, 'invoice'), record: invoiceRecord(mode, i)} : {status: 'mismatch'};
          } catch (e) { if (!notFound(e)) throw e; }
          const r = await get<{subscription?: Sub; customer?: {email?: string}}>('subscriptions.get', {'subscription-id': reference});
          if (r.subscription?.id !== reference) return {status: 'not_found'};
          return emailMatches(email, r.customer?.email) ? {status: 'verified', scope: scope(r.subscription.customer_id ?? null, reference, 'subscription'), record: subRecord(mode, r.subscription)} : {status: 'mismatch'};
        } catch (e) {
          if (notFound(e)) return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        switch (intent) {
          case 'order_status': {
            const out: BillingRecord[] = [];
            for (const id of s.recordIds.slice(0, 5)) {
              if (s.recordKinds[id] === 'invoice') { const i = (await get<{invoice?: Invoice}>('invoices.get', {'invoice-id': id})).invoice; if (i) out.push(invoiceRecord(mode, i)); }
              else { const x = (await get<{subscription?: Sub}>('subscriptions.get', {'subscription-id': id})).subscription; if (x) out.push(subRecord(mode, x)); }
            }
            return out;
          }
          case 'payment_history': return (await list<'transaction', Txn>('transactions.list', 'transaction', s)).filter((t) => t.type === 'payment').map((t) => txnRecord(mode, t));
          case 'failed_payment': return [
            ...(await list<'invoice', Invoice>('invoices.list', 'invoice', s)).map((i) => invoiceRecord(mode, i)).filter((r) => r.failure),
            ...(await list<'transaction', Txn>('transactions.list', 'transaction', s)).filter((t) => t.type === 'payment').map((t) => txnRecord(mode, t)).filter((r) => r.failure),
          ];
          case 'invoice': return (await list<'invoice', Invoice>('invoices.list', 'invoice', s)).map((i) => invoiceRecord(mode, i));
          case 'renewal': return (await list<'subscription', Sub>('subscriptions.list', 'subscription', s)).map((x) => subRecord(mode, x)).filter((r) => r.renewalAt);
          case 'refund_status': return (await list<'credit_note', Credit>('credit_notes.list', 'credit_note', s)).map((c) => ({
            ...base(mode, 'refund', c.id ?? '', c.date), status: c.status ?? 'unknown', amountMinor: c.amount_refunded || c.total || null, currency: upperCurrency(c.currency_code), customerRef: c.customer_id ?? null, parentRef: c.reference_invoice_id ?? null,
          }));
        }
      },
    };
  },
};
