/* AutomatePal plans: limits, features and the PayPal plan behind each paid tier and interval.
   The database has the same numbers in plan_limits() (db/057); scripts/verify-plans.ts fails if they drift.
   A "page" is 2,500 characters of source text, the unit the knowledge quota already counts.
   Prices are half of SiteGPT's list prices (pricing decision, Oct 29). Every paid plan starts with a
   $1 / 3-day trial (the PayPal plans' TRIAL cycle). */
export const PLAN_KEYS = ['free', 'starter', 'growth', 'scale', 'enterprise'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export type PaidPlanKey = 'starter' | 'growth' | 'scale';
export type BillingInterval = 'month' | 'year';
export const FEATURES = ['api', 'webhooks', 'mcp', 'billing_support', 'insights', 'scheduled_refresh'] as const;
export type Feature = (typeof FEATURES)[number];
export type PlanLimits = {messages: number; pages: number; sources: number; seats: number; bots: number; refresh: 'manual' | 'monthly' | 'weekly' | 'daily'; features: Feature[]};

export const PLANS: Record<PlanKey, PlanLimits & {name: string; price?: {month: number; year: number}}> = {
  free: {name: 'Free', messages: 100, pages: 50, sources: 50, seats: 1, bots: 1, refresh: 'manual', features: []},
  starter: {name: 'Starter', price: {month: 29.5, year: 234}, messages: 4000, pages: 1000, sources: 1000, seats: 1, bots: 1, refresh: 'manual', features: []},
  growth: {name: 'Growth', price: {month: 64.5, year: 474}, messages: 10000, pages: 10000, sources: 10000, seats: 4, bots: 2, refresh: 'monthly', features: ['api', 'webhooks', 'billing_support', 'scheduled_refresh']},
  scale: {name: 'Scale', price: {month: 214.5, year: 1554}, messages: 40000, pages: 50000, sources: 50000, seats: 10, bots: 3, refresh: 'weekly', features: ['api', 'webhooks', 'mcp', 'billing_support', 'insights', 'scheduled_refresh']},
  // Granted by hand (provider 'manual'), never sold through checkout.
  enterprise: {name: 'Enterprise', messages: 1000000, pages: 500000, sources: 500000, seats: 1000, bots: 1000, refresh: 'daily', features: ['api', 'webhooks', 'mcp', 'billing_support', 'insights', 'scheduled_refresh']},
};
export const PAID_PLANS: PaidPlanKey[] = ['starter', 'growth', 'scale'];
export const TRIAL = {days: 3, price: 1};

/* PayPal plan ids per tier and interval. Defaults are the six sandbox plans created on Oct 29
   (submission/sandbox-tier-plan-evidence.json). Override with PAYPAL_PLAN_IDS, a JSON object such as
   {"starter_month":"P-…","starter_year":"P-…",…}, when moving to live plans. */
const SANDBOX_PLAN_IDS: Record<`${PaidPlanKey}_${BillingInterval}`, string> = {
  starter_month: 'P-5E208892AF3612823NLRMB7I', starter_year: 'P-64G78479EW000615LNLRMB7Q',
  growth_month: 'P-2UP80051DE392742BNLRMB7Q', growth_year: 'P-60624726YA757600NNLRMB7Y',
  scale_month: 'P-3A665452CM947011CNLRMCAA', scale_year: 'P-2N903235F14990207NLRMCAA',
};
const PLAN_ID = /^P-[A-Z0-9]{10,58}$/;
export function paypalPlanIds(env: string | undefined = process.env.PAYPAL_PLAN_IDS): Record<`${PaidPlanKey}_${BillingInterval}`, string> {
  if (!env) return SANDBOX_PLAN_IDS;
  try {
    const o = JSON.parse(env) as Record<string, unknown>;
    const out = {...SANDBOX_PLAN_IDS};
    for (const k of Object.keys(SANDBOX_PLAN_IDS) as (keyof typeof SANDBOX_PLAN_IDS)[]) { if (typeof o[k] !== 'string' || !PLAN_ID.test(o[k] as string)) throw Error(k); out[k] = o[k] as string; }
    return out;
  } catch { throw Error('PAYPAL_PLAN_IDS must be JSON with all six P-… plan ids'); }
}
export function planForPaypalId(id: string, ids = paypalPlanIds()): {plan: PaidPlanKey; interval: BillingInterval} | null {
  for (const [k, v] of Object.entries(ids)) if (v === id) { const [plan, interval] = k.split('_') as [PaidPlanKey, BillingInterval]; return {plan, interval}; }
  return null;
}
export const hasFeature = (plan: PlanKey, f: Feature) => PLANS[plan].features.includes(f);
// Smallest paid plan that includes a feature, for upgrade prompts.
export const planWith = (f: Feature): PaidPlanKey => PAID_PLANS.find(p => hasFeature(p, f)) ?? 'scale';
