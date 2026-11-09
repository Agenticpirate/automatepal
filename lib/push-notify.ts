/* Push notifications for visitor events (db/063, lib/web-push.ts). No visitor text: the event, a ticket
   reference and a link that opens the ticket. Never throws; gone subscriptions are cleaned up. */
import type {SupabaseClient} from '@supabase/supabase-js';
import {serviceClient} from './service-db';
import {ticketLabel} from './tickets';
import {sendPush, vapidFromEnv, type PushSubscriptionKeys, type VapidKeys} from './web-push';
export type PushEvent = 'handoff' | 'refund_review' | 'lead';
const TITLE: Record<PushEvent, string> = {handoff: 'A visitor asked for a person', refund_review: 'A refund review was opened', lead: 'A visitor left contact details'};
export function pushMessage(event: PushEvent | 'test', caseId: string | null) {
  if (event === 'test') return {title: 'AutomatePal notifications are on', body: 'You will be told here when a visitor needs a person.', url: '/tickets', tag: 'automatepal-test'};
  return {title: TITLE[event], body: caseId ? `${ticketLabel(caseId)} · tap to open` : 'Tap to open Tickets', url: caseId ? `/tickets?ticket=${caseId}` : '/tickets', tag: caseId ? `case-${caseId}` : 'automatepal'};
}
type Target = PushSubscriptionKeys & {id: string};
export async function sendToTargets(client: SupabaseClient | null, targets: Target[], message: unknown, v: VapidKeys, f?: typeof fetch): Promise<{sent: number; failed: number}> {
  let sent = 0, failed = 0;
  await Promise.all(targets.map(async t => {
    const status = await sendPush(t, message, v, f);
    if (status >= 200 && status < 300) sent++; else failed++;
    if (client) await client.rpc('service_push_result', {p_id: t.id, p_status: status}).then(() => {}, () => {});
  }));
  return {sent, failed};
}
export async function notifyPush(caseHash: string, event: PushEvent, deps: {client?: SupabaseClient | null; fetch?: typeof fetch; env?: Record<string, string | undefined>} = {}): Promise<{sent: number; failed: number}> {
  try {
    const v = vapidFromEnv(deps.env); const client = deps.client === undefined ? serviceClient() : deps.client;
    if (!v || !client) return {sent: 0, failed: 0};
    const r = await client.rpc('service_push_targets', {p_case_hash: caseHash});
    const d = r.data as {caseId?: string; targets?: Target[]} | null;
    if (r.error || !d?.targets?.length) return {sent: 0, failed: 0};
    const out = await sendToTargets(client, d.targets, pushMessage(event, d.caseId ?? null), v, deps.fetch);
    console.info(JSON.stringify({event: 'push_alert', type: event, ...out}));
    return out;
  } catch { return {sent: 0, failed: 0}; }
}
