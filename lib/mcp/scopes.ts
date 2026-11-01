// Scope-to-tool map for the MCP server, shared by the server (lib/mcp/tools.ts) and the owner UI.
// db/046 and db/047 mcp_tool_allowed enforce the same map in the database.
export const TOOL_SCOPES = {
  list_knowledge_sources: ['mcp:read', 'knowledge:write'],
  get_unanswered_digest: ['mcp:read'],
  list_tickets: ['mcp:read', 'support:read', 'conversations:reply'],
  get_owner_overview: ['mcp:read', 'analytics:read'],
  get_billing_connection_status: ['mcp:read', 'support:read'],
  add_text_knowledge_source: ['knowledge:write'],
  ask_test_question: ['bot:test'],
  reply_to_conversation: ['conversations:reply'],
  read_settings: ['settings:read', 'settings:write'],
  update_settings: ['settings:write'],
} as const;
export type McpToolName = keyof typeof TOOL_SCOPES;
export const MCP_TOOL_SUMMARY: Record<McpToolName, string> = {
  list_knowledge_sources: 'Knowledge sources: titles, state, size (no source text)',
  get_unanswered_digest: 'Unanswered questions from the last 7 days',
  list_tickets: 'Latest 100 tickets: status, priority, inbox state',
  get_owner_overview: 'Overview counts: tickets, questions, requests, knowledge',
  get_billing_connection_status: 'Payment provider connections and 24 h lookup counts',
  add_text_knowledge_source: 'Propose a text source (stays unpublished until you approve)',
  ask_test_question: 'Preview a bot answer (not recorded)',
  reply_to_conversation: 'Reply in the widget to a conversation you already took over',
  read_settings: 'Working hours, away message, AI-or-person choice, contact field',
  update_settings: 'Change working hours, away message, AI-or-person choice, contact field',
};
