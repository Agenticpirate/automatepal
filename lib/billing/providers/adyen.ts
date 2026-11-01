import operations from '../../../fixtures/billing-specs/adyen/operations.json';
import {providerClient} from '../core/http';
import {isoTime, upperCurrency} from '../core/money';
import {emailMatches} from '../core/verify';
import {BillingError, type BillingAdapter, type BillingIntent, type BillingRecord, type OperationSpec, type ProviderDefinition} from '../core/types';

// Adyen Checkout API v71 (spec: Adyen/adyen-openapi CheckoutService-v71.json @ 1d165a077004, MIT).
// The Checkout API is mostly POST; the only useful GET read is a payment link. So this adapter
// supports order status and the hosted link only, and the bot says the rest are unsupported.
type Link = {id?: string; status?: string; reference?: string; merchantAccount?: string; amount?: {value?: number; currency?: string}; shopperEmail?: string; url?: string; expiresAt?: string; updatedAt?: string};
const OPS = operations as OperationSpec[];
const PREFIX = /^[a-z0-9]{1,40}(-[a-z0-9]{1,40})+$/i;
const none = {supported: false, operations: [] as string[]};
const record = (mode: 'test' | 'live', l: Link): BillingRecord => ({
  provider: 'adyen', mode, kind: 'order', id: l.id ?? '', displayRef: l.reference || l.id || '', status: l.status ?? 'unknown', amountMinor: typeof l.amount?.value === 'number' ? l.amount.value : null, currency: upperCurrency(l.amount?.currency),
  createdAt: isoTime(l.updatedAt), hostedUrl: l.url ?? null, renewalAt: null, failure: l.status === 'expired' ? {message: 'payment link expired before payment', attemptCount: null, nextRetryAt: null} : null, refunds: [], customerRef: null, parentRef: null,
});

export const definition: ProviderDefinition = {
  id: 'adyen',
  label: 'Adyen',
  tier: 'B',
  source: {confidence: 'official-spec'},
  modes: {test: {baseUrl: 'https://checkout-test.adyen.com/v71'}, live: {baseUrl: 'https://{prefix}-checkout-live.adyenpayments.com/checkout/v71'}},
  // The live host carries the merchant's own prefix; it is validated before use.
  baseUrl(mode, config) {
    if (mode === 'test') return 'https://checkout-test.adyen.com/v71';
    const prefix = (config.livePrefix ?? '').trim();
    if (!PREFIX.test(prefix)) throw new BillingError('invalid_credential', {publicMessage: 'Enter your Adyen live URL prefix (for example 1797a841fbb37ca7-AdyenDemo).'});
    return `https://${prefix.toLowerCase()}-checkout-live.adyenpayments.com/checkout/v71`;
  },
  credentialFields: [{name: 'apiKey', label: 'API key (Checkout webservice user)', secret: true, placeholder: 'AQE…'}],
  configFields: [{name: 'merchantAccount', label: 'Merchant account', placeholder: 'YourCompanyECOM'}, {name: 'livePrefix', label: 'Live URL prefix', placeholder: '1797a841fbb37ca7-AdyenDemo', liveOnly: true}],
  validateCredential(mode, cred, config = {}) {
    const k = (cred.apiKey ?? '').trim();
    if (!/^AQE[A-Za-z0-9+/=_.-]{20,400}$/.test(k)) return {ok: false, code: 'invalid_credential', message: 'Enter an Adyen API key (it starts with AQE).'};
    if (mode === 'live' && !PREFIX.test((config.livePrefix ?? '').trim())) return {ok: false, code: 'invalid_credential', message: 'LIVE mode needs your Adyen live URL prefix.'};
    if (config.merchantAccount && !/^[A-Za-z0-9_-]{2,80}$/.test(config.merchantAccount)) return {ok: false, code: 'invalid_credential', message: 'Merchant account names use letters, digits, - and _.'};
    return {ok: true, keyHint: `${k.slice(0, 5)}…${k.slice(-4)}`, warning: 'Adyen exposes only payment links through GET reads, so order status and the hosted link are the only lookups.'};
  },
  operations: OPS,
  capabilities: {
    order_status: {supported: true, operations: ['paymentLinks.get']},
    payment_history: none,
    failed_payment: none,
    invoice: {supported: true, operations: ['paymentLinks.get']},
    renewal: none,
    refund_status: none,
  },
  referencePatterns: [{kind: 'order', pattern: /^PL[A-Z0-9]{10,30}$/i, label: 'Payment link ID (PL…)'}],
  hostedHosts: {test: ['test.adyen.link', 'checkoutshopper-test.adyen.com'], live: ['pay.adyen.link', 'checkoutshopper-live.adyen.com']},
  createAdapter(cred, mode, deps): BillingAdapter {
    const {get} = providerClient(definition, mode, deps, async () => ({'X-API-Key': cred.apiKey}));
    const merchant = deps.config?.merchantAccount;
    const read = (id: string) => get<Link>('paymentLinks.get', {linkId: id});
    return {
      async testConnection() {
        // No list endpoint: a non-existent link id answers 404 once the key is accepted.
        try { await read('PLAUTOMATEPALCHECK0000'); } catch (e) { if (!(e instanceof BillingError && e.code === 'not_found')) throw e; }
        return {ok: true};
      },
      async verifyCustomer(reference, email) {
        try {
          const l = await read(reference.toUpperCase());
          if (l.id?.toUpperCase() !== reference.toUpperCase()) return {status: 'not_found'};
          // When the owner set a merchant account, links of other merchant accounts never verify.
          if (merchant && l.merchantAccount !== merchant) return {status: 'not_found'};
          return emailMatches(email, l.shopperEmail) ? {status: 'verified', scope: {provider: 'adyen', mode, customerId: null, recordIds: [l.id], recordKinds: {[l.id]: 'order'}}, record: record(mode, l)} : {status: 'mismatch'};
        } catch (e) {
          if (e instanceof BillingError && e.code === 'not_found') return {status: 'not_found'};
          throw e;
        }
      },
      async lookup(s, intent: BillingIntent) {
        if (intent !== 'order_status' && intent !== 'invoice') return [];
        const out: BillingRecord[] = [];
        for (const id of s.recordIds.slice(0, 5)) {
          const l = await read(id);
          if (!merchant || l.merchantAccount === merchant) out.push(record(mode, l));
        }
        return intent === 'invoice' ? out.filter((r) => r.hostedUrl) : out;
      },
    };
  },
};
