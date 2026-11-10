import {NextRequest, NextResponse} from 'next/server';
import {serviceClient} from '../../../../lib/service-db';
import {limitedJson} from '../../../../lib/limited-json';
import {allowRequest} from '../../../../lib/rate-limit';
import {clientIp} from '../../../../lib/widget-frame';
import {getSubscription, cancelSubscription, verifyWebhookSignature} from '../../../../lib/paypal';
import {eventSubscription, syncSubscription, billingNotice, SubscriptionError} from '../../../../lib/subscriptions';
/* PayPal webhooks for AutomatePal's own subscriptions (Phase 2). Order: body cap and shape, already-handled
   event id (idempotent), signature verified by PayPal against PAYPAL_WEBHOOK_ID, then the subscription is
   re-read from PayPal and synced (the event body itself is never trusted for state). Events we do not act on
   are acknowledged. A failure answers 500 so PayPal retries; nothing is recorded for it. */
export const dynamic = 'force-dynamic';
const H = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
const paypal = {get: getSubscription, cancel: cancelSubscription};
const ok = (outcome: string) => NextResponse.json({ok: true, outcome}, {headers: {'Cache-Control': 'no-store'}});
export async function POST(req: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID, service = serviceClient();
  if (!webhookId || !service) return NextResponse.json({error: 'Webhook not configured.'}, {status: 503});
  // Each event costs a verification call to PayPal; cap what one address can trigger (PayPal retries on 429).
  if (!await allowRequest('paypal-webhook:' + clientIp(req.headers), Date.now(), 120)) return NextResponse.json({error: 'Too many requests.'}, {status: 429, headers: {'Retry-After': '60'}});
  let event: unknown;
  try { event = await limitedJson(req, 64 * 1024); } catch { return NextResponse.json({error: 'Invalid body.'}, {status: 400}); }
  const e = eventSubscription(event);
  if (!e) return NextResponse.json({error: 'Invalid event.'}, {status: 400});
  const headers: Record<string, string> = {};
  for (const h of H) { const v = req.headers.get(h); if (!v || v.length > 2000) return NextResponse.json({error: 'Missing signature headers.'}, {status: 400}); headers[h] = v; }
  if (!/^https:\/\/api(-m)?\.(sandbox\.)?paypal\.com\//.test(headers['paypal-cert-url'])) return NextResponse.json({error: 'Unexpected certificate URL.'}, {status: 400});
  const seen = await service.rpc('paypal_event_seen', {p_id: e.id});
  if (seen.data === true) return ok('duplicate');
  let verified = false;
  try { verified = await verifyWebhookSignature(headers, event, webhookId); } catch { return NextResponse.json({error: 'Could not verify.'}, {status: 502}); }
  if (!verified) return NextResponse.json({error: 'Signature not valid.'}, {status: 401});
  if (!e.subscription) { await service.rpc('record_paypal_event', {p_id: e.id, p_type: e.type, p_subscription: null, p_outcome: 'ignored'}); return ok('ignored'); }
  try {
    const s = await syncSubscription(service, paypal, e.subscription);
    await service.rpc('record_paypal_event', {p_id: e.id, p_type: e.type, p_subscription: e.subscription, p_outcome: s.ignored ? 'ignored' : 'synced'});
    if (!s.ignored) {
      if (e.type === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' || e.type === 'BILLING.SUBSCRIPTION.SUSPENDED' || e.type === 'PAYMENT.SALE.DENIED') {
        const g = await service.from('workspace_subscriptions').select('grace_until').eq('workspace_id', s.row.workspace).maybeSingle();
        await billingNotice(service, s.row, 'payment_failed', (g.data?.grace_until as string | null) ?? null);
      } else if (e.type === 'BILLING.SUBSCRIPTION.EXPIRED') await billingNotice(service, s.row, 'expired', null);
    }
    return ok(s.ignored ? 'ignored' : 'synced');
  } catch (err) {
    // Not one of our plans or not linked to a workspace: acknowledge so PayPal stops retrying.
    if (err instanceof SubscriptionError && err.status === 400) { await service.rpc('record_paypal_event', {p_id: e.id, p_type: e.type, p_subscription: e.subscription, p_outcome: 'ignored'}); return ok('ignored'); }
    return NextResponse.json({error: 'Sync failed; PayPal will retry.'}, {status: 500});
  }
}
