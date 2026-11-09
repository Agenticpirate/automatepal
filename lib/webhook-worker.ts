/* Delivers due signed webhook events with the service role (db/059): right after a visitor request for that
   conversation's workspace, and in the hourly job for retries. Each event goes through lib/webhook.ts
   deliverWebhook (public IPv4 only, no redirects, size and time caps, HMAC signature). Never throws. */
import type {SupabaseClient} from '@supabase/supabase-js';
import {deliverWebhook} from './webhook';
type Claimed = {id: string; url: string; secret: string; payload: unknown; attempt: number};
export type WebhookRun = {ok: boolean; claimed: number; delivered: number; failed: number};
export async function deliverDueWebhooks(client: SupabaseClient, o: {workspace?: string; caseHash?: string; limit?: number; deadline?: number; deliver?: typeof deliverWebhook} = {}): Promise<WebhookRun> {
  const out: WebhookRun = {ok: true, claimed: 0, delivered: 0, failed: 0};
  try {
    const r = await client.rpc('service_webhook_claim', {p_ws: o.workspace ?? null, p_case_hash: o.caseHash ?? null, p_limit: o.limit ?? 10});
    if (r.error) return {...out, ok: false};
    const events = (r.data ?? []) as Claimed[];
    out.claimed = events.length;
    for (const e of events) {
      let status = 0;
      if (!o.deadline || Date.now() < o.deadline) { try { status = await (o.deliver ?? deliverWebhook)(e.url, e.secret, e.payload, e.id); } catch { status = 0; } }
      const f = await client.rpc('service_webhook_finish', {p_id: e.id, p_status: status, p_attempt: e.attempt});
      if (status >= 200 && status <= 299 && !f.error) out.delivered++; else out.failed++;
    }
  } catch { out.ok = false; }
  return out;
}
