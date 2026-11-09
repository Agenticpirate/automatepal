/* Which bot a dashboard request means (db/062). A bot id from the request when it is a UUID, else the Main bot,
   whose id is the workspace id. Ownership is always checked by the database: the RPCs resolve the bot through
   acting_bot(), and widget_settings writes go through RLS (acting workspace) plus a trigger that refuses a bot
   from another workspace. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function botParam(value: unknown, workspace: string): string {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : workspace;
}
/* For RPCs: NULL means the Main bot. */
export const rpcBot = (bot: string, workspace: string) => (bot === workspace ? null : bot);
