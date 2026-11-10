import {NextRequest, NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {serviceClient} from '../../../../../lib/service-db';
import {allowRequest} from '../../../../../lib/rate-limit';
import {refreshWorkspace} from '../../../../../lib/refresh';
/* Sources refresh API (Phase 3, db/064). POST with Authorization: Bearer <sources:refresh token>, no body.
   Runs the same bounded website refresh as the schedule, now: saved pages are re-read (least recently checked
   first) and new sitemap pages are found. Changes go to the owner's review queue on the Knowledge page; nothing
   is published by this call. One run per workspace per 10 minutes, 24 a day. Responds with counts only. */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const BEARER = /^Bearer (ap_ro_[a-f0-9]{64})$/;
const json = (b: unknown, status = 200, extra: Record<string, string> = {}) => NextResponse.json(b, {status, headers: {'Cache-Control': 'no-store', ...extra}});
export async function POST(req: NextRequest) {
  const token = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return json({error: 'Send Authorization: Bearer <AutomatePal API token with the sources:refresh scope>.'}, 401, {'WWW-Authenticate': 'Bearer realm="automatepal-sources"'});
  const th = createHash('sha256').update(token).digest('hex');
  if (!await allowRequest('refresh-api:' + th, Date.now(), 6)) return json({error: 'Rate limited. Try again in a minute.'}, 429, {'Retry-After': '60'});
  const service = serviceClient();
  if (!service) return json({error: 'The refresh API is not configured on this server.'}, 503);
  const claim = await service.rpc('api_refresh_claim', {p_token_hash: th});
  if (claim.error) return json({error: 'Service unavailable. Try again.'}, 503);
  const c = claim.data as {workspace?: string; sitemapUrl?: string | null; retryAfter?: number} | null;
  if (!c) return json({error: 'Token invalid, expired, revoked, without the sources:refresh scope, or the plan has no API access.'}, 401);
  if (!c.workspace) { const wait = Math.max(1, Number(c.retryAfter) || 600); return json({error: 'A refresh ran recently (one per 10 minutes, 24 a day).', retryAfter: wait}, 429, {'Retry-After': String(wait)}); }
  try {
    const run = await refreshWorkspace(service, {workspace: c.workspace, sitemapUrl: c.sitemapUrl ?? null}, Date.now() + 40_000);
    const s = run.summary;
    return json({ok: true, checked: s.checked, changed: s.changed, added: s.added, removed: s.removed, skipped: s.skipped, sitemap: s.sitemap, ...(s.stoppedBy ? {stoppedBy: s.stoppedBy} : {}), queuedForReview: run.items});
  } catch { return json({error: 'The refresh could not finish. Try again in 10 minutes.'}, 502); }
}
export function GET() { return json({error: 'Use POST with a sources:refresh bearer token.'}, 405, {Allow: 'POST'}); }
