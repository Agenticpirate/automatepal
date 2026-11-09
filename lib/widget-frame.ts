/* Signed permission for a website to frame the /help panel.
   /api/widget (after its origin check) signs {sha256(case token), embedding origin, expiry} with
   WIDGET_FRAME_SECRET. widget.js passes the three values to /help, and proxy.ts turns a valid signature into
   `frame-ancestors 'self' <origin>`; anything else gets `frame-ancestors 'self'`. So another site cannot frame
   a visitor's conversation, even with a stolen token, unless that site is in the owner's allowed origins.
   Web Crypto only, so the same code runs in the proxy, in route handlers and on Cloudflare Workers. */
export const WIDGET_KEY = /^pk_(live|test)_[A-Za-z0-9]{24}$/;
export const CASE_TOKEN = /^[a-f0-9]{64}$/;
const FRAME_TTL_S = 24 * 3600;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
// Local development (NODE_ENV=development only) falls back to a fixed secret so testing needs no setup;
// every other environment must set WIDGET_FRAME_SECRET or no grants are issued.
function secret(): string | null {
  const s = process.env.WIDGET_FRAME_SECRET;
  if (s && s.length >= 32) return s;
  return process.env.NODE_ENV === 'development' ? 'development-only-widget-frame-secret-000000' : null;
}
export async function sha256Hex(s: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export function frameOrigin(value: string | null | undefined): string | null {
  if (!value || value.length > 200) return null;
  try { const u = new URL(value); return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value ? value : null; } catch { return null; }
}
export type FrameGrant = {origin: string; exp: number; sig: string};
export async function signFrame(token: string, origin: string, now = Date.now()): Promise<FrameGrant | null> {
  const s = secret(), o = frameOrigin(origin);
  if (!s || !o || !CASE_TOKEN.test(token)) return null;
  const exp = Math.floor(now / 1000) + FRAME_TTL_S;
  return {origin: o, exp, sig: await hmac(s, `${await sha256Hex(token)}|${o}|${exp}`)};
}
// Constant-time compare of two hex strings of equal length.
function same(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export async function verifyFrame(token: string | null, origin: string | null, exp: string | null, sig: string | null, now = Date.now()): Promise<string | null> {
  const s = secret(), o = frameOrigin(origin), e = Number(exp);
  if (!s || !o || !token || !CASE_TOKEN.test(token) || !sig || !/^[a-f0-9]{64}$/.test(sig)) return null;
  if (!Number.isInteger(e) || e < now / 1000 || e > now / 1000 + FRAME_TTL_S + 60) return null;
  return same(await hmac(s, `${await sha256Hex(token)}|${o}|${e}`), sig) ? o : null;
}
// Client address for rate limiting only (never stored: lib/rate-limit.ts hashes keys).
// On Cloudflare only cf-connecting-ip is trusted (Cloudflare sets it; X-Forwarded-For can be sent by anyone).
export function clientIp(h: Headers, env: Record<string, string | undefined> = process.env): string {
  const cf = h.get('cf-connecting-ip');
  if (env.APP_PLATFORM === 'cloudflare') return cf ?? 'unknown';
  return cf ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
