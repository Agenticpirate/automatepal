import {createClient} from '@supabase/supabase-js';
import {needsRotation} from '../billing/core/crypto';
// Data access for the MCP server. Every call goes through the 046/047 token RPCs with the anon key: the RPCs
// validate the token hash (not revoked, not expired), the scope-to-tool map and the daily caps, and log one
// metadata row per call. Errors shown to MCP clients are generic; database messages never pass through.
export const MCP_SCOPES = ['mcp:read', 'support:read', 'analytics:read', 'knowledge:write', 'bot:test', 'conversations:reply', 'settings:read', 'settings:write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export type McpReadTool = 'knowledge_sources' | 'tickets' | 'unanswered' | 'overview' | 'billing_status';
export type McpChunk = {id: string; documentId: string; title: string; excerpt: string; embedding: unknown; sourceKind?: string; applicability?: string; effectiveFrom?: string | null; effectiveUntil?: string | null};
export type McpTestContext = {custom: unknown | null; chunks: McpChunk[]};
export interface McpBackend {
  tokenScope(hash: string): Promise<McpScope | null>;
  read(hash: string, tool: McpReadTool): Promise<Record<string, unknown>>;
  addSource(hash: string, title: string, content: string): Promise<{id: string}>;
  testContext(hash: string, question: string): Promise<McpTestContext>;
  reply(hash: string, caseId: string, body: string): Promise<{id: string}>;
  readSettings(hash: string): Promise<Record<string, unknown>>;
  updateSettings(hash: string, changes: Record<string, unknown>): Promise<Record<string, unknown>>;
}
// An error whose message is safe to show to the MCP client.
export class McpToolError extends Error {}
export const MCP_UNAVAILABLE = 'AutomatePal is temporarily unavailable. Try again shortly.';
type RpcResult = {ok?: boolean; data?: Record<string, unknown>; refused?: boolean; budget?: boolean; limit?: number; quota?: string; invalid?: string} | null;
export function unwrapRpc(r: RpcResult): Record<string, unknown> {
  if (!r) throw new McpToolError('Token invalid, expired or revoked.');
  if (r.refused) throw new McpToolError("This token's scope does not allow that tool.");
  if (r.budget) throw new McpToolError(r.quota ? r.quota : `Daily limit reached for this tool (${r.limit} per workspace per UTC day).`);
  if (typeof r.invalid === 'string') throw new McpToolError(r.invalid);
  if (r.ok !== true || !r.data || typeof r.data !== 'object') throw new McpToolError(MCP_UNAVAILABLE);
  return r.data;
}
type BillingRow = {provider: string; mode: string; status: string; last_checked_at: string | null; key_id?: string; lookups24h?: Record<string, number>};
export function supabaseMcpBackend(): McpBackend {
  const client = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {auth: {persistSession: false}});
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const {data, error} = await client().rpc(fn, args);
    if (error) throw new McpToolError(MCP_UNAVAILABLE);
    return data as RpcResult;
  };
  return {
    async tokenScope(hash) {
      const {data, error} = await client().rpc('mcp_token_scope', {p_hash: hash});
      if (error) throw Error('MCP token check unavailable');
      return (MCP_SCOPES as readonly string[]).includes(data as string) ? (data as McpScope) : null;
    },
    async read(hash, tool) {
      const data = unwrapRpc(await rpc('mcp_read_data', {p_hash: hash, p_tool: tool}));
      if (tool !== 'billing_status') return data;
      // The encryption key label never leaves the server; only whether it needs rotation.
      const rows = Array.isArray(data.connections) ? (data.connections as BillingRow[]) : [];
      return {connections: rows.map(({key_id, ...rest}) => ({...rest, needsRotation: needsRotation(key_id)}))};
    },
    async addSource(hash, title, content) {
      const data = unwrapRpc(await rpc('mcp_add_knowledge_source', {p_hash: hash, p_title: title, p_content: content}));
      if (typeof data.id !== 'string') throw new McpToolError(MCP_UNAVAILABLE);
      return {id: data.id};
    },
    async testContext(hash, question) {
      const data = unwrapRpc(await rpc('mcp_test_context', {p_hash: hash, p_question: question}));
      return {custom: data.custom ?? null, chunks: Array.isArray(data.chunks) ? (data.chunks as McpChunk[]) : []};
    },
    async reply(hash, caseId, body) {
      const data = unwrapRpc(await rpc('mcp_reply_to_conversation', {p_hash: hash, p_case: caseId, p_body: body}));
      if (typeof data.id !== 'string') throw new McpToolError(MCP_UNAVAILABLE);
      return {id: data.id};
    },
    async readSettings(hash) { return unwrapRpc(await rpc('mcp_read_settings', {p_hash: hash})); },
    async updateSettings(hash, changes) { return unwrapRpc(await rpc('mcp_update_settings', {p_hash: hash, p_settings: changes})); },
  };
}
