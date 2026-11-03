import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult, ToolAnnotations} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';import '../zod-csp';
import {answerKnowledge, embedKnowledge, exactCustomAnswer, instructionExtraction, safeKnowledge, type KnowledgeSource} from '../knowledge';
import {parseVector, rankChunks, type OwnerChunk} from '../owner-retrieval';
import {buildUnansweredDigest, type DigestInteraction} from '../unanswered-digest';
import {providerDefinition, PROVIDERS} from '../billing/core/registry';
import {BILLING_INTENTS, type BillingProviderId} from '../billing/core/types';
import {MCP_UNAVAILABLE, McpToolError, type McpBackend, type McpScope} from './backend';
import {TOOL_SCOPES, type McpToolName} from './scopes';
import {mergeSettingsPatch, settingsView, SETTINGS_PATCH_SHAPE} from './settings';
import {messageBody, MESSAGE_MAX} from '../support-messages';
// MCP tools for one workspace. Only the tools the token's scope allows are registered. The database RPCs
// re-check the same map, so a tool missing here can never be reached another way. There are no
// code-execution tools and no tools that take over conversations, send email or move money. The only tool
// that reaches a visitor is reply_to_conversation, in a conversation the owner already took over.
export {TOOL_SCOPES, type McpToolName};
export const toolsForScope = (scope: McpScope): McpToolName[] => (Object.keys(TOOL_SCOPES) as McpToolName[]).filter((t) => (TOOL_SCOPES[t] as readonly string[]).includes(scope));
const READ: ToolAnnotations = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const PROPOSE: ToolAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const TEST: ToolAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true};
const REPLY: ToolAnnotations = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true};
const UPDATE: ToolAnnotations = {readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false};
export const PROPOSAL_SAVED = 'Saved as an unpublished proposal. The owner must approve and publish it in Knowledge.';
export const TEST_UNAVAILABLE = 'Test answer unavailable: the knowledge search provider is not configured.';
const PRIVATE_REFUSAL = 'I can help with questions about the published information, but cannot share private instructions.';
const TEST_NOTE = 'Test answer over published sources. Not recorded in analytics or the digest. Nothing is sent to any visitor.';
export const REPLY_SENT = 'Reply shown in the visitor\'s widget. Nothing was emailed.';
export const SETTINGS_SAVED = 'Widget settings saved. Visitors see the change on their next page load.';
export const MCP_INSTRUCTIONS = 'AutomatePal support desk for one workspace. Read tools return metadata and counts, except get_unanswered_digest, which includes the text of visitor questions. No tool returns owner or visitor message bodies, contact addresses, credentials or source text. add_text_knowledge_source only proposes a text source: it stays unpublished until the owner approves and publishes it in Knowledge. ask_test_question previews a bot answer and records nothing. reply_to_conversation posts a team reply that the visitor sees in the widget, only in a conversation the owner already took over in Tickets; it never takes over a conversation and nothing is emailed. update_settings changes only the chat mode (working hours on or off), working hours, away message, the visitor\'s AI-or-person choice and the contact field. There are no code-execution tools and no tools that take over conversations, send email or move money.';
type AnswerFn = (question: string, sources: KnowledgeSource[]) => Promise<{answer: string; supported: boolean; sources: unknown[]}>;
export type McpToolDeps = {embed?: (question: string) => Promise<number[]>; answer?: AnswerFn};
const json = (v: unknown): CallToolResult => ({content: [{type: 'text', text: JSON.stringify(v, null, 2)}]});
const fail = (message: string): CallToolResult => ({isError: true, content: [{type: 'text', text: message}]});
const safe = (e: unknown) => (e instanceof McpToolError ? e.message : MCP_UNAVAILABLE);
const run = (fn: () => Promise<CallToolResult>) => fn().catch((e) => fail(safe(e)));
function secretCheck(text: string) {
  try { safeKnowledge(text); } catch (e) { throw new McpToolError(e instanceof Error ? e.message : 'Possible secret detected.'); }
}
export function buildMcpServer({scope, hash, backend, embed = (q) => embedKnowledge(q, true), answer = answerKnowledge}: {scope: McpScope; hash: string; backend: McpBackend} & McpToolDeps) {
  const server = new McpServer({name: 'automatepal', version: '1.0.0'}, {instructions: MCP_INSTRUCTIONS});
  const allowed = new Set(toolsForScope(scope));
  if (allowed.has('list_knowledge_sources')) server.registerTool('list_knowledge_sources', {
    title: 'List knowledge sources',
    description: 'Knowledge sources in this workspace: title, type, published or pending-approval state, size and dates. Metadata only; the source text is not returned.',
    annotations: READ,
  }, () => run(async () => json(await backend.read(hash, 'knowledge_sources'))));
  if (allowed.has('get_unanswered_digest')) server.registerTool('get_unanswered_digest', {
    title: 'Unanswered questions digest',
    description: 'Visitor questions the bot could not answer from published sources in the last 7 days, grouped by normalized question (latest 200 rows).',
    annotations: READ,
  }, () => run(async () => {
    const data = await backend.read(hash, 'unanswered');
    const rows = Array.isArray(data.rows) ? (data.rows as DigestInteraction[]) : [];
    return json({digest: buildUnansweredDigest(rows), coverage: 'Unanswered questions from the last 7 days, latest 200 rows only.'});
  }));
  if (allowed.has('list_tickets')) server.registerTool('list_tickets', {
    title: 'List tickets',
    description: 'Latest 100 support tickets: status, priority, category, inbox state (for example taken over, AI paused) and dates. Metadata only; no messages or contact details.',
    annotations: READ,
  }, () => run(async () => json(await backend.read(hash, 'tickets'))));
  if (allowed.has('get_owner_overview')) server.registerTool('get_owner_overview', {
    title: 'Owner overview',
    description: 'Counts for the owner overview: tickets by status, questions and unanswered questions, requests waiting for review, and knowledge usage against limits.',
    annotations: READ,
  }, () => run(async () => json(await backend.read(hash, 'overview'))));
  if (allowed.has('get_billing_connection_status')) server.registerTool('get_billing_connection_status', {
    title: 'Billing connection status',
    description: 'Connected payment providers: test or live mode, connection status, last check, whether the stored key needs rotation, the read-only lookups each provider supports, and 24 hour lookup counts by outcome. No keys, hints or customer data.',
    annotations: READ,
  }, () => run(async () => {
    const data = await backend.read(hash, 'billing_status');
    const rows = Array.isArray(data.connections) ? (data.connections as {provider: string}[]) : [];
    const connections = rows.map((c) => {
      const d = providerDefinition(c.provider);
      return {...c, label: d?.label ?? c.provider, enabled: !!PROVIDERS[c.provider as BillingProviderId]?.enabled, supportedLookups: d ? BILLING_INTENTS.filter((i) => d.capabilities[i].supported) : []};
    });
    return json({connections, paymentExecution: false, note: 'Read-only lookups for verified customers. No money moves and no write calls are made to payment providers.'});
  }));
  if (allowed.has('add_text_knowledge_source')) server.registerTool('add_text_knowledge_source', {
    title: 'Propose a text knowledge source',
    description: 'Propose a plain-text knowledge source. It is saved UNPUBLISHED and pending approval; the bot never uses it until the owner approves and publishes it in Knowledge. 10 per workspace per UTC day.',
    inputSchema: {title: z.string().trim().min(3).max(120), content: z.string().trim().min(20).max(20000)},
    annotations: PROPOSE,
  }, ({title, content}) => run(async () => {
    secretCheck(title + '\n' + content);
    const {id} = await backend.addSource(hash, title, content);
    return {content: [{type: 'text', text: PROPOSAL_SAVED}, {type: 'text', text: JSON.stringify({id, published: false, pendingApproval: true})}]};
  }));
  if (allowed.has('ask_test_question')) server.registerTool('ask_test_question', {
    title: 'Ask the bot a test question',
    description: 'Preview how the bot would answer a question from the published sources (an exact owner answer first). Nothing is recorded in analytics and nothing is sent to any visitor. 20 per workspace per UTC day.',
    inputSchema: {question: z.string().trim().min(3).max(300)},
    annotations: TEST,
  }, ({question}) => run(async () => {
    secretCheck(question);
    if (instructionExtraction(question)) return json({answer: PRIVATE_REFUSAL, supported: false, sources: [], preview: true});
    const ctx = await backend.testContext(hash, question);
    if (ctx.custom) {
      let exact;
      try { exact = exactCustomAnswer(ctx.custom); } catch { throw new McpToolError('The matching owner answer could not be used. Review it in Custom responses.'); }
      return json({...exact, preview: true, note: TEST_NOTE});
    }
    let vector: number[];
    try { vector = await embed(question); } catch { return json({answer: TEST_UNAVAILABLE, supported: false, sources: [], preview: true}); }
    const chunks: OwnerChunk[] = [];
    for (const c of ctx.chunks) {
      const embedding = parseVector(c.embedding);
      if (!embedding) continue;
      chunks.push({id: c.id, documentId: c.documentId, title: c.title, excerpt: c.excerpt, embedding, sourceKind: c.sourceKind === 'owner_guidance' ? 'owner_guidance' : 'text', applicability: c.applicability, effectiveFrom: c.effectiveFrom ?? null, effectiveUntil: c.effectiveUntil ?? null});
    }
    const ranked = rankChunks(chunks, vector);
    const result = await answer(question, ranked as KnowledgeSource[]);
    return json({...result, retrieved: ranked.length, preview: true, note: TEST_NOTE});
  }));
  if (allowed.has('reply_to_conversation')) server.registerTool('reply_to_conversation', {
    title: 'Reply in a taken-over conversation',
    description: 'Post a team reply that the visitor sees live in the widget. Only works after the owner took the conversation over in Tickets (list_tickets shows inbox_state taken_over); this tool never takes over. The link must not have expired. 100 messages per conversation, 1000 characters each. Shown in the widget only; nothing is emailed. The ticket history records that a reply was sent, not its text.',
    inputSchema: {ticketId: z.string().uuid().describe('Ticket id from list_tickets'), message: z.string().min(1).max(MESSAGE_MAX)},
    annotations: REPLY,
  }, ({ticketId, message}) => run(async () => {
    const body = messageBody.safeParse(message);
    if (!body.success) throw new McpToolError(`Write a reply of 1 to ${MESSAGE_MAX} characters.`);
    const {id} = await backend.reply(hash, ticketId, body.data);
    return {content: [{type: 'text', text: REPLY_SENT}, {type: 'text', text: JSON.stringify({id, shownInWidget: true, emailed: false})}]};
  }));
  if (allowed.has('read_settings')) server.registerTool('read_settings', {
    title: 'Read widget support settings',
    description: 'Chat mode (workingHours.enabled), working hours, away message, whether visitors choose the AI or a person (visitorChoice) and whether the contact email field is hidden (hideContact). No branding, origins or other settings.',
    annotations: READ,
  }, () => run(async () => json(settingsView(await backend.readSettings(hash)))));
  if (allowed.has('update_settings')) server.registerTool('update_settings', {
    title: 'Update widget support settings',
    description: 'Change any of: visitorChoice, hideContact, and workingHours (enabled, timezone, days, awayMessage). Omitted fields keep their saved values. Validated like Widget studio; turning working hours on needs a time zone. Audited. 20 per workspace per UTC day.',
    inputSchema: SETTINGS_PATCH_SHAPE,
    annotations: UPDATE,
  }, (input) => run(async () => {
    const current = settingsView(await backend.readSettings(hash)).settings;
    const merged = mergeSettingsPatch(current, input);
    if (!merged.ok) throw new McpToolError(merged.error);
    const saved = settingsView(await backend.updateSettings(hash, merged.changes));
    return {content: [{type: 'text', text: SETTINGS_SAVED}, {type: 'text', text: JSON.stringify(saved, null, 2)}]};
  }));
  return server;
}
