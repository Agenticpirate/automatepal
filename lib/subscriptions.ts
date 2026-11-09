/* AutomatePal's own subscriptions on PayPal (Phase 2, db/057). PayPal is the source of truth: every change,
   whether the visitor's approval, a webhook or a cancel, re-reads the subscription from PayPal and writes
   what it says through sync_paypal_subscription (service role). The workspace comes from the subscription's
   custom_id, which our checkout sets to the workspace id, and must match the signed-in workspace when a
   person activates it. Only PayPal plan ids listed in lib/plans.ts are accepted. */
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {planForPaypalId, PLANS, type BillingInterval, type PaidPlanKey} from './plans';
import {billingNoticeEmail, deliver, serviceEmailStore} from './email';

export const SUBSCRIPTION_ID = /^I-[A-Z0-9]{6,40}$/;
const paypalSubscription = z.object({
  id: z.string().regex(SUBSCRIPTION_ID),
  plan_id: z.string(),
  status: z.enum(['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED']),
  custom_id: z.string().uuid().optional(),
  billing_info: z.object({next_billing_time: z.string().datetime({offset: true}).optional()}).partial().optional(),
});
export type SubscriptionRow = {workspace: string; subscription: string; plan: PaidPlanKey; interval: BillingInterval; status: 'approval_pending' | 'active' | 'suspended' | 'cancelled' | 'expired'; periodEnd: string | null};
const STATUS = {APPROVAL_PENDING: 'approval_pending', APPROVED: 'approval_pending', ACTIVE: 'active', SUSPENDED: 'suspended', CANCELLED: 'cancelled', EXPIRED: 'expired'} as const;

export class SubscriptionError extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

export function subscriptionRow(raw: unknown, ids?: Parameters<typeof planForPaypalId>[1]): SubscriptionRow {
  const s = paypalSubscription.safeParse(raw);
  if (!s.success) throw new SubscriptionError('PayPal returned a subscription we cannot read.', 502);
  const plan = planForPaypalId(s.data.plan_id, ids);
  if (!plan) throw new SubscriptionError('That subscription is not for an AutomatePal plan.');
  if (!s.data.custom_id) throw new SubscriptionError('That subscription is not linked to a workspace.');
  return {workspace: s.data.custom_id, subscription: s.data.id, plan: plan.plan, interval: plan.interval, status: STATUS[s.data.status], periodEnd: s.data.billing_info?.next_billing_time ?? null};
}

export type PaypalSubscriptions = {get(id: string): Promise<unknown>; cancel(id: string, reason: string): Promise<unknown>};
export type SyncResult = {row: SubscriptionRow; plan: string; ignored?: string};

export async function syncSubscription(service: SupabaseClient, paypal: PaypalSubscriptions, id: string, opts: {workspace?: string; ids?: Parameters<typeof planForPaypalId>[1]} = {}): Promise<SyncResult> {
  if (!SUBSCRIPTION_ID.test(id)) throw new SubscriptionError('Invalid subscription id.');
  const row = subscriptionRow(await paypal.get(id), opts.ids);
  if (opts.workspace && row.workspace !== opts.workspace) throw new SubscriptionError('That subscription belongs to a different workspace.', 403);
  const r = await service.rpc('sync_paypal_subscription', {p_ws: row.workspace, p_subscription: row.subscription, p_plan: row.plan, p_interval: row.interval, p_status: row.status, p_period_end: row.periodEnd});
  if (r.error || !r.data) throw new SubscriptionError('Could not save the subscription. Try again in a minute.', 503);
  return {row, plan: r.data.plan ?? 'free', ignored: r.data.ignored};
}

/* One billing notice to the owner for a failed payment, a cancellation or an expiry. Best effort. */
export async function billingNotice(service: SupabaseClient, row: SubscriptionRow, kind: 'payment_failed' | 'cancelled' | 'expired', until: string | null): Promise<void> {
  try {
    const owner = await service.rpc('service_owner_email', {p_ws: row.workspace});
    if (owner.error || typeof owner.data !== 'string') return;
    await deliver(serviceEmailStore(service, row.workspace), billingNoticeEmail(owner.data, kind, PLANS[row.plan].name, until));
  } catch { /* notices never block billing */ }
}

/* Webhook event to subscription id, or null for events we do not act on. */
export const SUBSCRIPTION_EVENTS = new Set(['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.UPDATED', 'BILLING.SUBSCRIPTION.RE-ACTIVATED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED']);
export const SALE_EVENTS = new Set(['PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.DENIED', 'PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED']);
const webhookEvent = z.object({id: z.string().regex(/^[A-Za-z0-9-]{6,80}$/), event_type: z.string().max(80), resource: z.record(z.string(), z.unknown()).optional()});
export function eventSubscription(raw: unknown): {id: string; type: string; subscription: string | null} | null {
  const e = webhookEvent.safeParse(raw);
  if (!e.success) return null;
  const res = e.data.resource ?? {};
  const sub = SUBSCRIPTION_EVENTS.has(e.data.event_type) ? res.id : SALE_EVENTS.has(e.data.event_type) ? res.billing_agreement_id : null;
  return {id: e.data.id, type: e.data.event_type, subscription: typeof sub === 'string' && SUBSCRIPTION_ID.test(sub) ? sub : null};
}
