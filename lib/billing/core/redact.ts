import {BillingError, type BillingErrorCode} from './types';

// Order matters: specific key families first, then auth headers, emails and long opaque runs.
const RULES: [RegExp, string | ((...m: string[]) => string)][] = [
  [/\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]+/g, (_m, a, b) => `${a}_${b}_[redacted]`],
  [/\brzp_(test|live)_[A-Za-z0-9]+/g, (_m, a) => `rzp_${a}_[redacted]`],
  [/\bpdl_[A-Za-z0-9_]+/g, 'pdl_[redacted]'],
  [/\b(test|live)_[A-Za-z0-9]{10,}/g, (_m, a) => `${a}_[redacted]`],
  [/\bEAAA[A-Za-z0-9_-]{8,}/g, 'EAAA[redacted]'],
  [/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]'],
  [/\bBasic\s+[^\s"',;]+/gi, 'Basic [redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/[A-Za-z0-9+/=_-]{24,}/g, '[redacted]'],
];

export function redact(text: string): string {
  let out = String(text);
  for (const [re, rep] of RULES) out = out.replace(re, rep as never);
  return out;
}

// Keep a short type prefix and the last 4 characters: pay_1234567890abcd -> pay_…abcd.
export function redactId(id: string | null | undefined): string {
  if (!id) return '';
  const s = String(id);
  const prefix = s.match(/^([A-Za-z][A-Za-z0-9]{0,7}[_-])/)?.[1] ?? '';
  const rest = s.slice(prefix.length);
  if (rest.length <= 4) return prefix + '…' + rest.slice(-2);
  return prefix + '…' + rest.slice(-4);
}

const MESSAGES: Record<BillingErrorCode, string> = {
  auth_failed: 'The payment provider refused the connection key. The owner needs to check or replace it.',
  not_found: 'No matching billing record was found.',
  rate_limited: 'Billing lookups are busy right now. Try again in a few minutes.',
  provider_error: 'The payment provider did not respond correctly. Try again later or ask a person to review.',
  timeout: 'The payment provider took too long to respond. Try again later.',
  circuit_open: 'Billing lookups are paused briefly after repeated provider errors. Try again in a minute.',
  write_blocked: 'Blocked: only read-only billing requests are allowed.',
  invalid_credential: 'That credential does not look valid for this provider.',
  mode_mismatch: 'That key belongs to a different mode than the one selected.',
  refused_key: 'That key type is refused for billing support.',
  unsupported: "That lookup isn't available for this provider.",
};

// Only our own fixed strings ever leave: provider bodies and raw error text never do.
export function safeErrorMessage(e: unknown): string {
  if (e instanceof BillingError) return redact(e.publicMessage ?? MESSAGES[e.code]);
  return 'Billing lookup failed. Try again later or ask a person to review.';
}
