import type {BillingCard, BillingRecord, BillingScope, ProviderDefinition} from './types';

// A record is visible only when it is one of the verified records, a child of one, or belongs
// to the verified customer. Everything else is dropped, whatever the provider returned.
export function inScope(scope: BillingScope, r: BillingRecord): boolean {
  if (r.provider !== scope.provider || r.mode !== scope.mode) return false;
  if (scope.recordIds.includes(r.id)) return true;
  if (r.parentRef && scope.recordIds.includes(r.parentRef)) return true;
  if (scope.customerId && r.customerRef === scope.customerId) return true;
  return false;
}
export const filterScoped = (scope: BillingScope, records: BillingRecord[]) => records.filter((r) => inScope(scope, r));

// Hosted invoice/receipt links are shown only for https URLs on the provider's own hosts.
export function safeHostedUrl(u: string | null | undefined, allowedHosts: string[]): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return allowedHosts.includes(url.hostname.toLowerCase()) ? url.toString() : null;
  } catch { return null; }
}

export function toCard(definition: Pick<ProviderDefinition, 'label' | 'hostedHosts'>, r: BillingRecord): BillingCard {
  const {customerRef: _omit, ...rest} = r;
  void _omit;
  return {...rest, hostedUrl: safeHostedUrl(r.hostedUrl, definition.hostedHosts[r.mode]), providerLabel: definition.label};
}
