import {csvCell} from './exports';
/* Leads: consented contact emails that visitors left on widget requests (support_requests.contact_email with
   contact_consent). Owners with the manager role or higher can list, search, delete (db/047 delete_lead
   removes the address and the consent flag, the request stays) and export them as CSV. Nothing is forwarded
   to email or a CRM. */
export const LEAD_LIMIT = 500;
export type Lead = {id: string; case_id: string | null; created_at: string; kind: string; contact_email: string};
export const LEAD_COVERAGE = `Consented contact emails from widget requests, latest ${LEAD_LIMIT}. Nothing is forwarded to email or a CRM.`;
// Case-insensitive substring match on the email or request kind. Plain string matching, no patterns.
export function filterLeads(rows: Lead[], query: string): Lead[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.contact_email.toLowerCase().includes(q) || r.kind.replaceAll('_', ' ').includes(q));
}
// CSV with spreadsheet formula escaping (csvCell prefixes = + - @ tab and CR with an apostrophe) and quoting.
export function leadsCsv(rows: Lead[]): string {
  return ['Email,Captured UTC,Request kind,Request ID,Conversation ID', ...rows.map((r) => [r.contact_email, r.created_at, r.kind, r.id, r.case_id ?? ''].map(csvCell).join(','))].join('\n');
}
