import {definition as paypal} from '../providers/paypal';
import {definition as stripe} from '../providers/stripe';
import {definition as dodo} from '../providers/dodo';
import {definition as razorpay} from '../providers/razorpay';
import {definition as paddle} from '../providers/paddle';
import {definition as square} from '../providers/square';
import {definition as adyen} from '../providers/adyen';
import {definition as mollie} from '../providers/mollie';
import {definition as chargebee} from '../providers/chargebee';
import {definition as lemonsqueezy} from '../providers/lemonsqueezy';
import {BILLING_INTENTS, type BillingIntent, type BillingProviderId, type ProviderDefinition} from './types';

// A provider is enabled only after its contract test is wired into `npm run test:billing-support`
// and passes. The owner billing view, the widget, MCP billing status, the website and FEATURES.md
// read or mirror this flag. Providers without an adapter are simply absent.
export type RegistryEntry = {definition: ProviderDefinition; enabled: boolean};
export const PROVIDERS: Partial<Record<BillingProviderId, RegistryEntry>> = {
  paypal: {definition: paypal, enabled: true},
  stripe: {definition: stripe, enabled: true},
  dodo: {definition: dodo, enabled: true},
  razorpay: {definition: razorpay, enabled: true},
  paddle: {definition: paddle, enabled: true},
  square: {definition: square, enabled: true},
  adyen: {definition: adyen, enabled: true},
  mollie: {definition: mollie, enabled: true},
  chargebee: {definition: chargebee, enabled: true},
  lemonsqueezy: {definition: lemonsqueezy, enabled: true},
};

export const enabledProviders = (): ProviderDefinition[] => Object.values(PROVIDERS).filter((e): e is RegistryEntry => !!e?.enabled).map((e) => e.definition);
export const enabledProviderIds = (): BillingProviderId[] => enabledProviders().map((d) => d.id);
export function enabledDefinition(id: BillingProviderId | string): ProviderDefinition | null {
  const e = PROVIDERS[id as BillingProviderId];
  return e?.enabled ? e.definition : null;
}
export const providerDefinition = (id: BillingProviderId | string): ProviderDefinition | null => PROVIDERS[id as BillingProviderId]?.definition ?? null;

// What the visitor widget may know: enabled, connected providers with their mode and capability
// matrix, and whether this chat is verified. Never credentials or record data.
export type VisitorBillingSupport = {
  providers: {provider: BillingProviderId; label: string; mode: 'test' | 'live'; capabilities: Record<BillingIntent, boolean>; referenceHint: string}[];
  verified: {provider: BillingProviderId; label: string; expiresAt: string} | null;
};
export function visitorBillingSupport(status: {providers: {provider: BillingProviderId; mode: 'test' | 'live'}[]; verified: {provider: BillingProviderId; expiresAt: string} | null} | null): VisitorBillingSupport | null {
  if (!status) return null;
  const providers = (status.providers ?? []).flatMap((p) => {
    const d = enabledDefinition(p.provider);
    return d ? [{provider: d.id, label: d.label, mode: p.mode === 'live' ? 'live' as const : 'test' as const, capabilities: Object.fromEntries(BILLING_INTENTS.map((i) => [i, d.capabilities[i].supported])) as Record<BillingIntent, boolean>, referenceHint: d.referencePatterns.map((x) => x.label).join(', ')}] : [];
  });
  if (!providers.length) return null;
  const v = status.verified && providers.find((p) => p.provider === status.verified!.provider);
  return {providers, verified: v ? {provider: v.provider, label: v.label, expiresAt: status.verified!.expiresAt} : null};
}

// Safe, browser-facing description of every enabled provider.
export function providerSummaries() {
  return enabledProviders().map((d) => ({
    id: d.id,
    label: d.label,
    tier: d.tier,
    confidence: d.source.confidence,
    enabled: true,
    credentialFields: d.credentialFields,
    configFields: d.configFields ?? [],
    capabilities: Object.fromEntries(BILLING_INTENTS.map((i) => [i, d.capabilities[i].supported])) as Record<BillingIntent, boolean>,
    modes: ['test', 'live'] as const,
    referenceHint: d.referencePatterns.map((p) => p.label).join(', '),
  }));
}
