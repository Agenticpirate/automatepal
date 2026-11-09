import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {SLACK_URL, postSlack} from '../../../lib/slack';
/* Slack alerts settings (db/061), admins and the owner. GET: whether a webhook is set (last 4 characters only).
   POST {url|null, enabled, test?}: save, clear, or send one test message to the URL just entered. */
const noStore = {'Cache-Control': 'no-store'};
export async function GET(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  const r = await c.client.rpc('my_slack_settings');
  if (r.error) return NextResponse.json({error: 'Slack settings are not available yet.'}, {status: 503, headers: noStore});
  return NextResponse.json({settings: r.data, canEdit: r.data !== null}, {headers: noStore});
}
const body = z.object({url: z.string().trim().regex(SLACK_URL).nullable(), enabled: z.boolean().default(true), test: z.boolean().default(false)});
export async function POST(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  if (!await allowRequest('slack:' + c.actorId, Date.now(), 6)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  let d: z.infer<typeof body>;
  try { d = body.parse(await limitedJson(req, 2000)); } catch { return NextResponse.json({error: 'Paste a Slack incoming-webhook URL (https://hooks.slack.com/services/…).'}, {status: 400}); }
  const r = await c.client.rpc('set_slack_settings', {p_url: d.url, p_enabled: d.enabled});
  if (r.error) return NextResponse.json({error: /Upgrade required/.test(r.error.message) ? 'Slack alerts are included from the Growth plan. Upgrade on the Plan page.' : 'Only admins and the owner can change Slack alerts.'}, {status: /Upgrade/.test(r.error.message) ? 402 : 403});
  if (d.url && d.test) {
    const status = await postSlack(d.url, {text: ':white_check_mark: AutomatePal alerts are connected to this channel.'});
    return NextResponse.json({note: status >= 200 && status < 300 ? 'Saved. A test message was posted to Slack.' : `Saved, but Slack answered ${status || 'nothing'} to the test message. Check the webhook URL.`}, {headers: noStore});
  }
  return NextResponse.json({note: d.url ? 'Slack alerts saved.' : 'Slack alerts removed.'}, {headers: noStore});
}
