import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {authenticate, roleAtLeast} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {limitedJson} from '../../../lib/limited-json';
import {demoGate, demoLocked} from '../../../lib/demo-open';
import {filterLeads, LEAD_COVERAGE, LEAD_LIMIT, type Lead} from '../../../lib/leads';
// Leads for the acting workspace: consented contact emails on widget requests. Manager role and up. Reads are
// scoped by RLS to the acting workspace (and filtered by user_id); deletion goes through db/047 delete_lead,
// which checks the role and workspace again. No forwarding to email or a CRM.
const DENIED = 'Only managers, admins and the owner can see and manage leads.';
const noStore = {'Cache-Control': 'no-store'};
export async function GET(req: NextRequest) {
  const ctx = await authenticate(req);
  if (!ctx) { const d = demoGate(req, 'leads'); if (d) return d; return NextResponse.json({error: 'Please sign in.'}, {status: 401}); }
  if (!roleAtLeast(ctx.role, 'manager')) return NextResponse.json({error: DENIED}, {status: 403, headers: noStore});
  const q = z.string().max(100).catch('').parse(req.nextUrl.searchParams.get('q') ?? '');
  const {data, error} = await ctx.client.from('support_requests').select('id,case_id,created_at,kind,contact_email')
    .eq('user_id', ctx.userId).eq('contact_consent', true).not('contact_email', 'is', null)
    .order('created_at', {ascending: false}).limit(LEAD_LIMIT);
  if (error) return NextResponse.json({error: 'Could not load leads.'}, {status: 503, headers: noStore});
  const rows = (data ?? []) as Lead[];
  return NextResponse.json({leads: filterLeads(rows, q), total: rows.length, limit: LEAD_LIMIT, role: ctx.role, coverage: LEAD_COVERAGE}, {headers: noStore});
}
export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return NextResponse.json({error: 'Invalid origin'}, {status: 403});
  const ctx = await authenticate(req);
  if (!ctx) { const d = demoLocked(); if (d) return d; return NextResponse.json({error: 'Please sign in.'}, {status: 401}); }
  if (!roleAtLeast(ctx.role, 'manager')) return NextResponse.json({error: DENIED}, {status: 403});
  if (!await allowRequest('leads:' + ctx.actorId)) return NextResponse.json({error: 'Please wait a minute.'}, {status: 429});
  try {
    const d = z.object({action: z.literal('delete'), id: z.string().uuid()}).parse(await limitedJson(req, 2000));
    const r = await ctx.client.rpc('delete_lead', {p_id: d.id});
    if (r.error) return NextResponse.json({error: 'Lead not deleted. Try again.'}, {status: 503});
    if (!r.data) return NextResponse.json({error: 'Lead not found or already deleted.'}, {status: 404});
    return NextResponse.json({note: 'Lead deleted: the email address and consent were removed. The request itself stays in Tickets.'});
  } catch {
    return NextResponse.json({error: 'Check the request fields.'}, {status: 400});
  }
}
