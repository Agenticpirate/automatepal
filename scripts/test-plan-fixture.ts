// For DB suites that test features which now need a paid plan (db/057). Inside the suite's own transaction
// (rolled back at the end), every workspace counts as Enterprise. This replaces workspace_plan() for this
// transaction only, takes no table locks (other connections keep seeing the real function) and is undone by
// the rollback. A suite can switch plans mid-transaction with select set_config('test.plan','free',true).
// Plan gates themselves are tested in verify-plans-db.ts.
export const COMP_FIXTURES_SQL = `
 CREATE OR REPLACE FUNCTION public.workspace_plan(p_ws uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $f$ SELECT coalesce(nullif(current_setting('test.plan',true),''),'enterprise') $f$;`;
