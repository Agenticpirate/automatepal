import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticate, authenticateUser, roleAtLeast } from '../../../lib/session';
import { validOrigin } from '../../../lib/origin';
import { allowRequest } from '../../../lib/rate-limit';
import { limitedJson } from '../../../lib/limited-json';
import { demoGate, demoLocked } from '../../../lib/demo-open';
import { deliver, memberEmailStore, teamInviteEmail } from '../../../lib/email';

const noStore = { 'Cache-Control': 'no-store' };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const role = z.enum(['admin', 'manager', 'agent']);
const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), email: z.string().trim().toLowerCase().email().max(254), role }),
  z.object({ action: z.literal('revoke_invite'), id: z.string().uuid() }),
  z.object({ action: z.literal('set_role'), user: z.string().uuid(), role }),
  z.object({ action: z.literal('remove'), user: z.string().uuid() }),
  z.object({ action: z.literal('leave'), workspace: z.string().uuid() }),
  z.object({ action: z.literal('accept'), token: z.string().regex(/^ap_inv_[a-f0-9]{64}$/) }),
]);
// Database messages that are safe to show as-is; anything else becomes a generic message.
const SAFE = /^(Insufficient role|Already a member|Invite already pending|Seat limit reached|Invite unavailable|Invalid invite|Invalid role change|Assignee is not on this team|The owner cannot leave their own workspace|Use leave_workspace to leave)$/;
const msg = (e: unknown) => { const m = (e as { message?: string })?.message ?? ''; return SAFE.test(m) ? (m === 'Use leave_workspace to leave' ? 'You cannot remove yourself. Leave the workspace instead.' : m) : 'Team service unavailable.'; };

export async function GET(req: NextRequest) {
  const user = await authenticateUser(req);
  if (!user) { const d = demoGate(req, 'team'); if (d) return d; return NextResponse.json({ error: 'Please sign in.' }, { status: 401 }); }
  const mine = await user.client.rpc('my_workspaces');
  if (mine.error) return NextResponse.json({ error: 'Team workspaces are not enabled on this database yet.' }, { status: 503, headers: noStore });
  const ctx = await authenticate(req);
  if (!ctx) return NextResponse.json({ me: { id: user.actorId, email: user.email }, workspaces: mine.data, current: null, workspaceInvalid: true }, { headers: noStore });
  const team = await ctx.client.rpc('workspace_team');
  const invites = roleAtLeast(ctx.role, 'manager') ? await ctx.client.rpc('workspace_pending_invites') : { data: [], error: null };
  if (team.error || invites.error) return NextResponse.json({ error: 'Team service unavailable.' }, { status: 503, headers: noStore });
  return NextResponse.json({ me: { id: ctx.actorId, email: ctx.email }, workspaces: mine.data, current: { workspace_id: ctx.userId, role: ctx.role }, team: team.data, invites: invites.data }, { headers: noStore });
}

export async function POST(req: NextRequest) {
  const locked = demoLocked();
  const user = await authenticateUser(req);
  if (!user) { if (locked) return locked; return NextResponse.json({ error: 'Please sign in.' }, { status: 401 }); }
  if (!validOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  if (!allowRequest('team:' + user.actorId)) return NextResponse.json({ error: 'Please wait a minute.' }, { status: 429 });
  let body: z.infer<typeof Action>;
  try { body = Action.parse(await limitedJson(req, 4000)); } catch { return NextResponse.json({ error: 'Check the fields and try again.' }, { status: 400 }); }
  try {
    if (body.action === 'accept') {
      const r = await user.client.rpc('accept_workspace_invite', { p_hash: sha(body.token) });
      if (r.error) throw r.error;
      return NextResponse.json({ note: 'Invite accepted.', workspace: r.data }, { headers: noStore });
    }
    if (body.action === 'leave') {
      const r = await user.client.rpc('leave_workspace', { p_workspace: body.workspace });
      if (r.error) throw r.error;
      return NextResponse.json({ note: r.data ? 'You left the workspace.' : 'You are not a member of that workspace.' }, { headers: noStore });
    }
    const ctx = await authenticate(req);
    if (!ctx) return NextResponse.json({ error: 'Workspace unavailable. Switch workspace and try again.' }, { status: 403 });
    if (body.action === 'invite') {
      const token = 'ap_inv_' + randomBytes(32).toString('hex');
      const r = await ctx.client.rpc('create_workspace_invite', { p_email: body.email, p_role: body.role, p_hash: sha(token) });
      if (r.error) throw r.error;
      const origin = process.env.APP_URL || req.nextUrl.origin;
      // Token travels in the URL fragment, so it never reaches server logs or referrers.
      const link = `${new URL(origin).origin}/invite#${token}`;
      // The link is still shown once here; the email (lib/email.ts) is a convenience and never blocks the invite.
      const mail = await deliver(memberEmailStore(ctx.client), teamInviteEmail(body.email, link, body.role)).catch(() => ({ status: 'failed' as const }));
      const mailNote = mail.status === 'sent' ? ' We also emailed it to them.' : mail.status === 'dry_run' ? ' Email is not configured on this server, so no invite email was sent.' : ' The invite email was not sent.';
      return NextResponse.json({ note: 'Invite created. Share this link privately; it works once, for 7 days, and only for that email address.' + mailNote, link, email: mail.status }, { headers: { ...noStore, 'Referrer-Policy': 'no-referrer' } });
    }
    if (body.action === 'revoke_invite') {
      const r = await ctx.client.rpc('revoke_workspace_invite', { p_id: body.id });
      if (r.error) throw r.error;
      return NextResponse.json({ note: r.data ? 'Invite revoked.' : 'Invite was already used or revoked.' }, { headers: noStore });
    }
    if (body.action === 'set_role') {
      const r = await ctx.client.rpc('set_member_role', { p_user: body.user, p_role: body.role });
      if (r.error) throw r.error;
      return NextResponse.json({ note: r.data ? 'Role updated.' : 'That person is not on this team.' }, { headers: noStore });
    }
    const r = await ctx.client.rpc('remove_member', { p_user: body.user });
    if (r.error) throw r.error;
    return NextResponse.json({ note: r.data ? 'Member removed. Their ticket assignments were cleared.' : 'That person is not on this team.' }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: msg(e) }, { status: 400, headers: noStore });
  }
}
