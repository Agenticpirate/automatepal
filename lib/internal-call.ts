/* Marks requests one route handler makes to another inside the same process (the public chat API runs the
   widget's answer handler). The value is random per process and never leaves it, so an outside caller cannot
   claim to be internal. Used only to skip per-visitor-IP limits that would otherwise count every API caller
   behind one address; the API path has its own per-token limit. */
const SECRET = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export const INTERNAL_HEADER = 'x-automatepal-internal';
export const internalHeaders = (): Record<string, string> => ({[INTERNAL_HEADER]: SECRET});
export function isInternal(h: Headers): boolean {
  const v = h.get(INTERNAL_HEADER);
  if (!v || v.length !== SECRET.length) return false;
  let d = 0; for (let i = 0; i < v.length; i++) d |= v.charCodeAt(i) ^ SECRET.charCodeAt(i);
  return d === 0;
}
