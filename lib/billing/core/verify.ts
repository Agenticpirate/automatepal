import {createHash, timingSafeEqual} from 'node:crypto';
import type {ProviderDefinition, ReferencePattern} from './types';

// Payment email comparison: trimmed, lowercased, compared as sha256 digests in constant time.
// The email is never stored or logged.
const digest = (s: string) => createHash('sha256').update(s.trim().toLowerCase()).digest();
export function emailMatches(given: string | null | undefined, onRecord: string | null | undefined): boolean {
  if (!given || !onRecord) return false;
  return timingSafeEqual(digest(given), digest(onRecord));
}

// Visitors paste references with stray "#", spaces or quotes.
export function normalizeReference(ref: string): string {
  return String(ref).trim().replace(/^["'#\s]+|["'\s]+$/g, '').replace(/\s+/g, '');
}

export function matchReference(definition: Pick<ProviderDefinition, 'referencePatterns'>, ref: string): {pattern: ReferencePattern; value: string} | null {
  const value = normalizeReference(ref);
  if (value.length < 3 || value.length > 80) return null;
  for (const pattern of definition.referencePatterns) if (pattern.pattern.test(value)) return {pattern, value};
  return null;
}
