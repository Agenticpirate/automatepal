// Offline checks for leads (lib/leads.ts, app/api/leads): search, formula-safe CSV export, the manager role
// gate, and the API refusing anonymous requests with demo mode off. The database side (workspace isolation,
// delete_lead roles) is verify-leads-db.ts; the page is verify-leads-ui.mjs.
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {filterLeads, leadsCsv, LEAD_COVERAGE, type Lead} from '../lib/leads';
import {roleAtLeast} from '../lib/session';
let n = 0;
const ok = () => { n++; };
const rows: Lead[] = [
  {id: '11111111-1111-4111-8111-111111111111', case_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: '2026-11-01T10:00:00.000Z', kind: 'lead_callback', contact_email: 'Buyer.One@Example.com'},
  {id: '22222222-2222-4222-8222-222222222222', case_id: null, created_at: '2026-10-31T09:00:00.000Z', kind: 'human_handoff', contact_email: '=HYPERLINK("http://evil.example","x")@x.example'},
  {id: '33333333-3333-4333-8333-333333333333', case_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: '2026-10-30T08:00:00.000Z', kind: 'refund_request', contact_email: '+cmd@x.example'},
  {id: '44444444-4444-4444-8444-444444444444', case_id: null, created_at: '2026-10-29T08:00:00.000Z', kind: 'lead_callback', contact_email: '-2+3@x.example'},
  {id: '55555555-5555-4555-8555-555555555555', case_id: null, created_at: '2026-10-28T08:00:00.000Z', kind: 'lead_callback', contact_email: '@SUM(A1)@x.example'},
  {id: '66666666-6666-4666-8666-666666666666', case_id: null, created_at: '2026-10-27T08:00:00.000Z', kind: 'lead_callback', contact_email: '\tTAB@x.example'},
];
// Search: case-insensitive substring on email or kind; plain text, so % _ * are literal.
assert.deepEqual(filterLeads(rows, 'buyer.one').map((r) => r.id), [rows[0].id]); ok();
assert.deepEqual(filterLeads(rows, '  EXAMPLE.COM ').map((r) => r.id), [rows[0].id]); ok();
assert.deepEqual(filterLeads(rows, 'handoff').map((r) => r.id), [rows[1].id], 'kind with spaces'); ok();
assert.deepEqual(filterLeads(rows, 'human handoff').map((r) => r.id), [rows[1].id]); ok();
assert.equal(filterLeads(rows, '').length, rows.length); ok();
assert.deepEqual(filterLeads(rows, '%'), [], 'no pattern wildcards'); ok();
assert.deepEqual(filterLeads(rows, '*'), []); ok();
// CSV: header, every cell quoted, quotes doubled, formula-leading cells prefixed with an apostrophe.
const csv = leadsCsv(rows).split('\n');
assert.equal(csv[0], 'Email,Captured UTC,Request kind,Request ID,Conversation ID'); ok();
assert.equal(csv[1], `"Buyer.One@Example.com","2026-11-01T10:00:00.000Z","lead_callback","${rows[0].id}","${rows[0].case_id}"`); ok();
assert.ok(csv[2].startsWith(`"'=HYPERLINK(""http://evil.example"",""x"")@x.example",`), csv[2]); ok();
assert.ok(csv[3].startsWith(`"'+cmd@x.example",`)); ok();
assert.ok(csv[4].startsWith(`"'-2+3@x.example",`)); ok();
assert.ok(csv[5].startsWith(`"'@SUM(A1)@x.example",`)); ok();
assert.ok(csv[6].startsWith(`"'\tTAB@x.example",`)); ok();
for (const line of csv.slice(1)) { assert.doesNotMatch(line, /^"[=+\-@\t\r]/, 'no cell starts a formula'); assert.match(line, /,""$|,"[0-9a-f-]{36}"$/); }
ok();
assert.equal(leadsCsv([]), 'Email,Captured UTC,Request kind,Request ID,Conversation ID'); ok();
// Role gate used by the API: manager, admin and owner; never agent.
assert.deepEqual((['owner', 'admin', 'manager', 'agent'] as const).map((r) => roleAtLeast(r, 'manager')), [true, true, true, false]); ok();
assert.match(LEAD_COVERAGE, /Nothing is forwarded to email or a CRM/); ok();
// API with demo mode off: anonymous GET is 401 and POST without a valid origin is 403, before any database call.
async function main() {
  process.env.NEXT_PUBLIC_DEMO_OPEN = 'false';
  const {GET, POST} = await import('../app/api/leads/route');
  const g = await GET(new NextRequest('http://127.0.0.1/api/leads'));
  assert.equal(g.status, 401); ok();
  const p = await POST(new NextRequest('http://127.0.0.1/api/leads', {method: 'POST', headers: {origin: 'https://evil.example', 'content-type': 'application/json'}, body: JSON.stringify({action: 'delete', id: rows[0].id})}));
  assert.equal(p.status, 403); ok();
  console.log(`PASS leads: ${n} checks; plain substring search on email and kind, CSV quoted with doubled quotes and = + - @ tab escaped, manager-or-higher gate, anonymous 401 and foreign origin 403.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
