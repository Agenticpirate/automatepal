import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
/* Bots in this workspace (db/062). GET: the bots (Main bot first) with install-key state, and the plan's bot
   limit. POST (managers and up): create, rename, delete (not the Main bot), or limit a knowledge source /
   exact answer to some bots ("scope"). All checks are repeated in the database. */
const noStore = {'Cache-Control': 'no-store'};
export type BotRow = {id: string; name: string; main: boolean; publicKey: string | null; keyActive: boolean};
export async function GET(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  const [b, s, p] = await Promise.all([
    c.client.from('bots').select('id,name,created_at').order('created_at'),
    c.client.from('widget_settings').select('bot_id,public_key,key_active').eq('user_id', c.userId),
    c.client.rpc('my_plan'),
  ]);
  if (b.error) return NextResponse.json({error: 'Bots are not available on this database yet.'}, {status: 503, headers: noStore});
  const keys = new Map((s.data ?? []).map(r => [r.bot_id as string, r]));
  const rows: BotRow[] = (b.data ?? []).map(r => ({id: r.id, name: r.name, main: r.id === c.userId, publicKey: (keys.get(r.id)?.public_key as string | null) ?? null, keyActive: !!keys.get(r.id)?.key_active}));
  if (!rows.some(r => r.main)) rows.unshift({id: c.userId, name: 'Main bot', main: true, publicKey: (keys.get(c.userId)?.public_key as string | null) ?? null, keyActive: !!keys.get(c.userId)?.key_active});
  rows.sort((a, z) => Number(z.main) - Number(a.main));
  return NextResponse.json({bots: rows, limit: p.data?.limits?.bots ?? 1, canManage: ['owner', 'admin', 'manager'].includes(c.role ?? '')}, {headers: noStore});
}
const body = z.discriminatedUnion('action', [
  z.object({action: z.literal('create'), name: z.string().trim().min(1).max(60)}),
  z.object({action: z.literal('rename'), id: z.string().uuid(), name: z.string().trim().min(1).max(60)}),
  z.object({action: z.literal('delete'), id: z.string().uuid()}),
  z.object({action: z.literal('scope'), kind: z.enum(['source', 'response']), id: z.string().uuid(), bots: z.array(z.string().uuid()).max(100).nullable()}),
]);
export async function POST(req: NextRequest) {
  const c = await authenticate(req); if (!c) return NextResponse.json({error: 'Please sign in.'}, {status: 401});
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  if (!await allowRequest('bots:' + c.actorId)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  let d: z.infer<typeof body>;
  try { d = body.parse(await limitedJson(req, 6000)); } catch { return NextResponse.json({error: 'Check the bot name and try again.'}, {status: 400}); }
  const fail = (e: {message: string}, fallback: string) => NextResponse.json({error: /Upgrade required/.test(e.message) ? e.message.replace(/^Upgrade required: /, 'Your plan includes this many bots: ').replace(/your plan includes /, '') + '. Upgrade on the Plan page for more.' : /duplicate|unique/i.test(e.message) ? 'A bot with that name already exists.' : /Main bot/.test(e.message) ? 'The Main bot cannot be deleted.' : fallback}, {status: /Upgrade required/.test(e.message) ? 402 : 400});
  if (d.action === 'create') { const r = await c.client.rpc('create_bot', {p_name: d.name}); if (r.error) return fail(r.error, 'Could not create the bot. Managers and above can do this.'); return NextResponse.json({id: r.data, note: `Bot "${d.name}" created. Set its look and create its install script.`}, {headers: noStore}); }
  if (d.action === 'rename') { const r = await c.client.rpc('rename_bot', {p_id: d.id, p_name: d.name}); if (r.error || !r.data) return fail(r.error ?? {message: ''}, 'Could not rename the bot.'); return NextResponse.json({note: 'Bot renamed.'}, {headers: noStore}); }
  if (d.action === 'delete') { const r = await c.client.rpc('delete_bot', {p_id: d.id}); if (r.error || !r.data) return fail(r.error ?? {message: ''}, 'Could not delete the bot.'); return NextResponse.json({note: 'Bot deleted. Its install script stopped working; its conversations now show under the Main bot.'}, {headers: noStore}); }
  const r = await c.client.rpc('set_knowledge_bots', {p_kind: d.kind, p_id: d.id, p_bots: d.bots});
  if (r.error || !r.data) return fail(r.error ?? {message: ''}, 'Could not change which bots use this.');
  return NextResponse.json({note: d.bots?.length ? 'Saved. Only the chosen bots use this.' : 'Saved. Every bot uses this.'}, {headers: noStore});
}
