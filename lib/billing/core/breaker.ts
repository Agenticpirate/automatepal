// In-process circuit breaker and token bucket, per connection id. Bounded maps (1000 entries).
const MAX = 1000;
const FAILURES = 5;
const OPEN_MS = 60_000;

type BreakerState = {failures: number; openUntil: number; probing: boolean};
const breakers = new Map<string, BreakerState>();
const buckets = new Map<string, {tokens: number; at: number}>();
const cooldowns = new Map<string, number>();

function bounded<V>(m: Map<string, V>, key: string, v: V) {
  if (!m.has(key) && m.size >= MAX) m.delete(m.keys().next().value as string);
  m.set(key, v);
}

// True when a request may go out. After OPEN_MS one half-open probe is let through.
export function breakerAllows(id: string, now: number): boolean {
  const s = breakers.get(id);
  if (!s || s.openUntil === 0) return true;
  if (now < s.openUntil) return false;
  if (s.probing) return false;
  s.probing = true;
  return true;
}
export function breakerSuccess(id: string) { breakers.delete(id); }
export function breakerFailure(id: string, now: number) {
  const s = breakers.get(id) ?? {failures: 0, openUntil: 0, probing: false};
  s.failures++;
  if (s.probing || s.failures >= FAILURES) { s.openUntil = now + OPEN_MS; s.probing = false; }
  bounded(breakers, id, s);
}
export function breakerState(id: string, now: number): 'closed' | 'open' | 'half_open' {
  const s = breakers.get(id);
  if (!s || s.openUntil === 0) return 'closed';
  return now < s.openUntil ? 'open' : 'half_open';
}

// 10 requests per 10 seconds per connection, refilled continuously.
const CAPACITY = 10;
const REFILL_MS = 10_000;
export function takeToken(id: string, now: number): boolean {
  const b = buckets.get(id) ?? {tokens: CAPACITY, at: now};
  b.tokens = Math.min(CAPACITY, b.tokens + ((now - b.at) / REFILL_MS) * CAPACITY);
  b.at = now;
  if (b.tokens < 1) { bounded(buckets, id, b); return false; }
  b.tokens -= 1;
  bounded(buckets, id, b);
  return true;
}

// Provider asked us to back off (429 with a long Retry-After).
export function setCooldown(id: string, until: number) { bounded(cooldowns, id, until); }
export function inCooldown(id: string, now: number): boolean {
  const until = cooldowns.get(id);
  if (until === undefined) return false;
  if (now >= until) { cooldowns.delete(id); return false; }
  return true;
}

export function resetConnection(id: string) { breakers.delete(id); buckets.delete(id); cooldowns.delete(id); }
export function resetAllBreakers() { breakers.clear(); buckets.clear(); cooldowns.clear(); }
