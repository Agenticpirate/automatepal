/* Slack alerts (db/061). One short message per visitor event to the workspace's Slack incoming webhook. No
   visitor text: the event, a ticket reference and a link to Tickets. Only hooks.slack.com is ever contacted
   (the URL shape is checked here and in the database), no redirects, 5-second timeout. Never throws. */
import type {SupabaseClient} from '@supabase/supabase-js';
import {serviceClient} from './service-db';
import {ticketLabel} from './tickets';
import {appUrl} from './email';
export const SLACK_URL = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]{8,64}$/;
export type SlackEvent = 'handoff' | 'refund_review' | 'lead';
const TEXT: Record<SlackEvent, string> = {handoff: ':raising_hand: A visitor asked to talk to a person', refund_review: ':receipt: A refund review was opened', lead: ':envelope: A visitor left contact details'};
export function slackMessage(event: SlackEvent, caseId: string, base = appUrl()) {
  return {text: `${TEXT[event]} (${ticketLabel(caseId)}). Open Tickets: ${base}/tickets`};
}
export async function postSlack(url: string, body: unknown, f: typeof fetch = fetch): Promise<number> {
  if (!SLACK_URL.test(url)) return 0;
  try { const r = await f(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(5000)}); return r.status; } catch { return 0; }
}
export async function notifySlack(caseHash: string, event: SlackEvent, deps: {client?: SupabaseClient | null; fetch?: typeof fetch} = {}): Promise<number> {
  try {
    const client = deps.client === undefined ? serviceClient() : deps.client;
    if (!client) return 0;
    const t = await client.rpc('service_slack_target', {p_case_hash: caseHash});
    const d = t.data as {url?: string; caseId?: string} | null;
    if (t.error || !d?.url || !d.caseId) return 0;
    const status = await postSlack(d.url, slackMessage(event, d.caseId), deps.fetch);
    console.info(JSON.stringify({event: 'slack_alert', type: event, status}));
    return status;
  } catch { return 0; }
}
