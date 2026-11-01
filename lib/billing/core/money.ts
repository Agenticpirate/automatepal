// Decimal-string and display helpers. ISO 4217 minor units for the non-2-decimal currencies.
const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);
export const minorDigits = (currency: string | null | undefined) => {
  const c = String(currency ?? '').toUpperCase();
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2;
};

// "19.00" USD -> 1900. Returns null for anything that is not a plain decimal.
export function toMinor(value: string | number | null | undefined, currency: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const digits = minorDigits(currency);
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const padded = (frac + '000').slice(0, digits);
  const n = Number(whole) * 10 ** digits + (digits ? Number(padded) : 0);
  return Number.isSafeInteger(n) ? (neg ? -n : n) : null;
}

export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined || !currency) return '';
  const digits = minorDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const s = digits ? `${Math.floor(abs / 10 ** digits)}.${String(abs % 10 ** digits).padStart(digits, '0')}` : String(abs);
  return `${currency.toUpperCase()} ${sign}${s}`;
}

export const upperCurrency = (c: unknown): string | null => (typeof c === 'string' && /^[A-Za-z]{3}$/.test(c) ? c.toUpperCase() : null);

// Unix seconds or ISO string -> ISO string.
export function isoTime(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  if (typeof v === 'string' && v && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v)).toISOString();
  return null;
}
