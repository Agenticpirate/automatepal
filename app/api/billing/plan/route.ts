import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate} from '../../../../lib/session';
import {validOrigin} from '../../../../lib/origin';
import {allowRequest} from '../../../../lib/rate-limit';
import {limitedJson} from '../../../../lib/limited-json';
import {serviceClient} from '../../../../lib/service-db';
import {PLANS, PAID_PLANS, TRIAL, paypalPlanIds, type PaidPlanKey} from '../../../../lib/plans';
import {syncSubscription, SubscriptionError, SUBSCRIPTION_ID, billingNotice} from '../../../../lib/subscriptions';
import {getSubscription, cancelSubscription, reviseSubscription} from '../../../../lib/paypal';
import {appUrl} from '../../../../lib/email';
/* The workspace's AutomatePal plan (Phase 2).
   GET: plan, limits, usage and subscription (db/057 my_plan, agent and up), plus what the checkout needs
   (PayPal client id, plan ids, prices). The client id is public by design.
   POST (workspace owner only; billing authority stays with the owner):
   - activate {subscriptionId}: after PayPal approval in the browser. Re-reads it from PayPal; it must be one
     of our plans and its custom_id must be this workspace.
   - change {plan, interval}: PayPal revise; returns PayPal's approval link. The new plan applies after the
     owner approves and PayPal reports it (webhook, or refresh on return).
   - cancel: cancels at PayPal; access continues to the end of the paid period.
   - refresh: re-reads the current subscription from PayPal. */
const noStore = {'Cache-Control': 'no-store'};
const paypal = {get: getSubscription, cancel: cancelSubscription};
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  const r = await ctx.client.rpc('my_plan');
  if (r.error || !r.data) return NextResponse.json({error: 'Plan information is not available yet.'}, {status: 503, headers: noStore});
  let ids: ReturnType<typeof paypalPlanIds> | null = null;
  try { ids = paypalPlanIds(); } catch { ids = null; }
  return NextResponse.json({
    ...r.data,
    canManage: r.data.role === 'owner',
    workspace: ctx.userId,
    checkout: ids && process.env.PAYPAL_CLIENT_ID ? {clientId: process.env.PAYPAL_CLIENT_ID, sandbox: (process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com').includes('sandbox'), planIds: ids} : null,
    catalog: PAID_PLANS.map(k => ({key: k, ...PLANS[k]})), free: PLANS.free, trial: TRIAL,
  }, {headers: noStore});
}
const body = z.discriminatedUnion('action', [
  z.object({action: z.literal('activate'), subscriptionId: z.string().regex(SUBSCRIPTION_ID)}),
  z.object({action: z.literal('change'), plan: z.enum(['starter', 'growth', 'scale']), interval: z.enum(['month', 'year'])}),
  z.object({action: z.literal('cancel')}),
  z.object({action: z.literal('refresh')}),
]);
export async function POST(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  if (ctx.role !== 'owner') return NextResponse.json({error: 'Only the workspace owner can change the plan.'}, {status: 403});
  if (!await allowRequest('plan:' + ctx.actorId, Date.now(), 10)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  const service = serviceClient();
  if (!service) return NextResponse.json({error: 'Billing is not configured on this server.'}, {status: 503});
  let d: z.infer<typeof body>;
  try { d = body.parse(await limitedJson(req, 2000)); } catch { return NextResponse.json({error: 'Invalid request.'}, {status: 400}); }
  try {
    if (d.action === 'activate') {
      const s = await syncSubscription(service, paypal, d.subscriptionId, {workspace: ctx.userId});
      return NextResponse.json({plan: s.plan, status: s.row.status, note: s.row.status === 'active' ? `You are on ${PLANS[s.row.plan].name}. Thank you!` : 'PayPal has not activated the subscription yet. This page updates when it does.'}, {headers: noStore});
    }
    const cur = await service.from('workspace_subscriptions').select('provider,provider_subscription_id,status').eq('workspace_id', ctx.userId).maybeSingle();
    const subId = cur.data?.provider === 'paypal' ? cur.data.provider_subscription_id as string : null;
    if (!subId) return NextResponse.json({error: d.action === 'change' ? 'Subscribe to a plan first.' : 'There is no PayPal subscription on this workspace.'}, {status: 400});
    if (d.action === 'refresh') {
      const s = await syncSubscription(service, paypal, subId, {workspace: ctx.userId});
      return NextResponse.json({plan: s.plan, status: s.row.status}, {headers: noStore});
    }
    if (d.action === 'cancel') {
      if (cur.data?.status === 'cancelled' || cur.data?.status === 'expired') return NextResponse.json({error: 'This subscription is already cancelled.'}, {status: 400});
      await cancelSubscription(subId, 'Cancelled by the workspace owner in AutomatePal');
      const s = await syncSubscription(service, paypal, subId, {workspace: ctx.userId});
      await billingNotice(service, s.row, 'cancelled', s.row.periodEnd ?? null);
      return NextResponse.json({plan: s.plan, status: s.row.status, note: 'Subscription cancelled. You keep your plan until the end of the period you paid for; nothing is deleted.'}, {headers: noStore});
    }
    const planId = paypalPlanIds()[`${d.plan as PaidPlanKey}_${d.interval}`];
    const base = appUrl();
    const r = await reviseSubscription(subId, planId, `${base}/plan?changed=1`, `${base}/plan`);
    const approve = r.links?.find(l => l.rel === 'approve')?.href;
    if (!approve || !/^https:\/\/www\.(sandbox\.)?paypal\.com\//.test(approve)) return NextResponse.json({error: 'PayPal did not return an approval link. Try again.'}, {status: 502});
    return NextResponse.json({approveUrl: approve, note: 'Approve the change in PayPal. The new plan applies once PayPal confirms it.'}, {headers: noStore});
  } catch (e) {
    if (e instanceof SubscriptionError) return NextResponse.json({error: e.message}, {status: e.status});
    return NextResponse.json({error: 'PayPal could not complete that right now. Nothing was changed; try again in a minute.'}, {status: 502});
  }
}
