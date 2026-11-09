import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {pushEndpointOk, vapidFromEnv} from '../../../lib/web-push';
import {pushMessage, sendToTargets} from '../../../lib/push-notify';
/* Push notifications on this person's devices (db/063). GET: whether push is set up on the server, the public
   key browsers subscribe with, and the person's devices. POST: subscribe this device, unsubscribe it, or send
   a test notification to the person's own devices. */
const noStore = {'Cache-Control': 'no-store'};
export async function GET(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  const v = vapidFromEnv();
  const d = await c.client.from('push_subscriptions').select('id,label,created_at,last_success_at').order('created_at', {ascending: false});
  return NextResponse.json({available: !!v, publicKey: v?.publicKey ?? null, devices: d.error ? [] : d.data}, {headers: noStore});
}
const body = z.discriminatedUnion('action', [
  z.object({action: z.literal('subscribe'), endpoint: z.string().max(1000), keys: z.object({p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,30}$/)}), label: z.string().trim().max(60).optional()}),
  z.object({action: z.literal('unsubscribe'), endpoint: z.string().max(1000)}),
  z.object({action: z.literal('test')}),
]);
export async function POST(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  if (!await allowRequest('push:' + c.actorId, Date.now(), 10)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  let d: z.infer<typeof body>;
  try { d = body.parse(await limitedJson(req, 4000)); } catch { return NextResponse.json({error: 'Invalid request.'}, {status: 400}); }
  if (d.action === 'subscribe') {
    if (!pushEndpointOk(d.endpoint)) return NextResponse.json({error: 'This browser uses a push service we do not support.'}, {status: 400});
    const r = await c.client.rpc('save_push_subscription', {p_endpoint: d.endpoint, p_p256dh: d.keys.p256dh, p_auth: d.keys.auth, p_label: d.label ?? null});
    if (r.error) return NextResponse.json({error: /Ten devices/.test(r.error.message) ? r.error.message : 'Could not turn on notifications for this device.'}, {status: 400});
    return NextResponse.json({note: 'Notifications are on for this device.'}, {headers: noStore});
  }
  if (d.action === 'unsubscribe') { await c.client.rpc('delete_push_subscription', {p_endpoint: d.endpoint}); return NextResponse.json({note: 'Notifications are off for this device.'}, {headers: noStore}); }
  const v = vapidFromEnv(); if (!v) return NextResponse.json({error: 'Push is not set up on this server.'}, {status: 503});
  const t = await c.client.rpc('my_push_targets');
  const targets = (t.data ?? []) as {id: string; endpoint: string; p256dh: string; auth: string}[];
  if (!targets.length) return NextResponse.json({error: 'No devices yet. Turn notifications on first.'}, {status: 400});
  const r = await sendToTargets(null, targets, pushMessage('test', null), v);
  return NextResponse.json({note: r.sent ? `Test sent to ${r.sent} device${r.sent === 1 ? '' : 's'}.` : 'The push service did not accept the test. Turn notifications off and on again on that device.'}, {headers: noStore});
}
