/* "Which bot's conversations" for Overview, Tickets and Chat history (db/062). ?bot=<uuid> narrows to one bot;
   absent or "all" keeps the whole workspace. A conversation without a bot belongs to the Main bot, whose id is
   the workspace id. Rows linked to a conversation (questions, requests, labels, widget opens) are narrowed
   through an inner join to support_cases. Workspace isolation stays with RLS; this only narrows. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function statsBot(value: string | null | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}
// Structural view of a PostgREST filter builder; kept loose so callers keep their own precise builder type.
type Filterable = {or(filters: string, opts?: {referencedTable?: string}): unknown; eq(column: string, value: unknown): unknown};
/* On a support_cases query. */
export function byCaseBot<T>(q: T, bot: string | null, workspace: string): T {
  if (!bot) return q;
  const f = q as unknown as Filterable;
  return (bot === workspace ? f.or(`bot_id.is.null,bot_id.eq.${workspace}`) : f.eq('bot_id', bot)) as T;
}
/* On a query of a table that selects support_cases!inner(id). */
export function byJoinedBot<T>(q: T, bot: string | null, workspace: string): T {
  if (!bot) return q;
  const f = q as unknown as Filterable;
  return (bot === workspace ? f.or(`bot_id.is.null,bot_id.eq.${workspace}`, {referencedTable: 'support_cases'}) : f.eq('support_cases.bot_id', bot)) as T;
}
