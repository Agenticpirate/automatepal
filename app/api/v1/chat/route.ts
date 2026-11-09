import {NextRequest, NextResponse} from 'next/server';
import {createHash, randomBytes} from 'node:crypto';
import {z} from 'zod';
import {serviceClient} from '../../../../lib/service-db';
import {allowRequest} from '../../../../lib/rate-limit';
import {limitedJson} from '../../../../lib/limited-json';
import {POST as supportPost} from '../../support/route';
import {internalHeaders} from '../../../../lib/internal-call';
/* Public chat API (Phase 3, db/060). POST {question, conversation?} with Authorization: Bearer <chat:write token>.
   Without a conversation it opens one (24 hours) and returns its id; pass it back to continue. Every answer runs
   the widget's own answer path (app/api/support: prompt-injection guard, per-conversation and monthly limits,
   exact owner answers, published sources only, grounding check, transcript), so API answers count against the
   same plan. The conversation id is a capability for that conversation; keep it server-side. */
const BEARER = /^Bearer (ap_ro_[a-f0-9]{64})$/;
const body = z.object({question: z.string().trim().min(3).max(500), conversation: z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const json = (b: unknown, status = 200) => NextResponse.json(b, {status, headers: {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});
export async function POST(req: NextRequest) {
  const token = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return NextResponse.json({error: 'Send Authorization: Bearer <AutomatePal API token with the chat:write scope>.'}, {status: 401, headers: {'WWW-Authenticate': 'Bearer realm="automatepal-chat"'}});
  const th = sha(token);
  if (!await allowRequest('chat-api:' + th, Date.now(), 30)) return json({error: 'Rate limited. Try again in a minute.'}, 429);
  let d: z.infer<typeof body>;
  try { d = body.parse(await limitedJson(req, 4000)); } catch { return json({error: 'Send JSON {"question": "...", "conversation"?: "<id from a previous reply>"}.'}, 400); }
  const service = serviceClient();
  if (!service) return json({error: 'Chat API is not configured on this server.'}, 503);
  let conversation = d.conversation, expiresAt: string | undefined;
  if (conversation) {
    const okConv = await service.rpc('api_conversation_ok', {p_token_hash: th, p_case_hash: sha(conversation)});
    if (okConv.error) return json({error: 'Service unavailable. Try again.'}, 503);
    if (okConv.data !== true) return json({error: 'Conversation not found or expired. Omit "conversation" to start a new one.'}, 404);
  } else {
    conversation = randomBytes(32).toString('hex');
    const opened = await service.rpc('api_open_conversation', {p_token_hash: th, p_case_hash: sha(conversation)});
    if (opened.error) return json({error: /Daily/.test(opened.error.message) ? 'Daily conversation limit reached.' : 'Service unavailable. Try again.'}, opened.error.message.includes('Daily') ? 429 : 503);
    if (!opened.data) return json({error: 'Token invalid, expired, revoked, without the chat:write scope, or the plan has no API access.'}, 401);
    expiresAt = opened.data.expiresAt;
  }
  // Same answer path as the widget.
  const inner = await supportPost(new NextRequest(new URL('/api/support', req.url), {method: 'POST', headers: {'Content-Type': 'application/json', ...internalHeaders()}, body: JSON.stringify({action: 'answer', token: conversation, question: d.question, source: 'widget'})}));
  const r = await inner.json().catch(() => ({error: 'Answer unavailable.'})) as Record<string, unknown>;
  if (!inner.ok) return json({conversation, ...(expiresAt ? {expiresAt} : {}), error: r.error ?? 'Answer unavailable.'}, inner.status);
  return json({conversation, ...(expiresAt ? {expiresAt} : {}), answer: r.answer, supported: r.supported, answerKind: r.answerKind ?? 'source_answer', sources: r.sources ?? []});
}
