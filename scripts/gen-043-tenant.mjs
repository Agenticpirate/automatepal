// Generates the second half of db/043_workspace_members.sql from a LOCAL database at the 042 state.
// For each public function that scopes by auth.uid(): swap in public.acting_workspace() and add a
// minimum-role gate. Every function must appear in ROLES, so a new one cannot slip through ungated.
// Usage: LOCAL_DATABASE_URL=... node scripts/gen-043-tenant.mjs >> db/043_workspace_members.sql
import pg from 'pg';
const url = process.env.LOCAL_DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('LOCAL_DATABASE_URL must point at the local database');

// Minimum role per function. agent < manager < admin < owner.
const ROLES = {
  add_ticket_note: 'agent', set_support_inbox: 'agent', support_review_request: 'agent', update_service_ticket: 'agent',
  update_tickets: 'agent', record_operational_event: 'agent',
  decide_ticket_review: 'manager', delete_knowledge_source: 'manager', fail_knowledge_attempt: 'manager',
  save_custom_response: 'manager', save_guidance_attempt: 'manager', save_knowledge_attempt: 'manager',
  save_knowledge_source: 'manager', start_knowledge_attempt: 'manager', record_owner_alert_check: 'manager',
  operational_summary: 'manager',
  claim_demo_webhook: 'admin', configure_demo_webhook: 'admin', finish_demo_webhook: 'admin',
  create_readonly_token: 'admin', revoke_readonly_token: 'admin', reserve_catalog_ai: 'admin',
  proof_claim_operation: 'admin', proof_finish_operation: 'admin',
  delete_preview_data: 'owner',
};
// Rewritten by hand in 043 (triggers that need actor semantics).
const HANDWRITTEN = new Set(['record_owner_audit', 'record_ticket_state']);

const c = new pg.Client({connectionString: url});
await c.connect();
const rows = (await c.query(`select p.proname, l.lanname, pg_get_functiondef(p.oid) def from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where n.nspname='public' and p.prokind='f' order by p.proname`)).rows.filter(r => r.def.includes('auth.uid()'));
await c.end();

const out = [];
const missing = [];
for (const r of rows) {
  if (HANDWRITTEN.has(r.proname)) continue;
  const role = ROLES[r.proname];
  if (!role) { missing.push(r.proname); continue; }
  if (r.lanname !== 'plpgsql') throw Error(`${r.proname}: expected plpgsql, got ${r.lanname}`);
  let def = r.def.replaceAll('auth.uid()', 'public.acting_workspace()');
  // Gate only callers who resolved a workspace; NULL keeps each function's own signed-out handling.
  const gate = `\n IF public.acting_workspace() IS NOT NULL AND NOT public.workspace_role_at_least('${role}') THEN RAISE EXCEPTION 'Insufficient role';END IF;`;
  const body = def.indexOf('$function$');
  const begin = def.indexOf('\nBEGIN', body);
  if (body < 0 || begin < 0) throw Error(`${r.proname}: cannot find body BEGIN`);
  def = def.slice(0, begin + 6) + gate + def.slice(begin + 6);
  if (r.proname === 'delete_preview_data') {
    const ret = def.lastIndexOf(' RETURN true;');
    if (ret < 0) throw Error('delete_preview_data: RETURN true not found');
    def = def.slice(0, ret) + ' DELETE FROM workspace_invites WHERE workspace_id=uid;\n DELETE FROM workspace_members WHERE workspace_id=uid;\n' + def.slice(ret);
  }
  out.push(`-- ${r.proname}: minimum role ${role}\n${def.trim()};\n`);
}
if (missing.length) throw Error('No role mapping for: ' + missing.join(', '));
const unused = Object.keys(ROLES).filter(k => !rows.some(r => r.proname === k));
if (unused.length) throw Error('Mapped but not found: ' + unused.join(', '));
console.log(out.join('\n'));
console.log(`-- ${out.length} functions regenerated.`);
