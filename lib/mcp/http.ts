import {createHash} from 'node:crypto';
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {limitedJson} from '../limited-json';
import {allowRequest} from '../rate-limit';
import type {McpBackend} from './backend';
import {buildMcpServer, type McpToolDeps} from './tools';
// Stateless Streamable HTTP endpoint for /mcp. Order: Origin, method, bearer shape (no DB call), per-token
// rate limit, token scope from the database, 64 KB body cap, then a fresh server + transport per request.
export const MCP_BODY_LIMIT = 65536;
const BEARER = /^Bearer (ap_ro_[a-f0-9]{64})$/;
const base = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow'};
const reply = (status: number, error: string, headers: Record<string, string> = {}) => new Response(JSON.stringify({error}), {status, headers: {...base, 'Content-Type': 'application/json', ...headers}});
const unauthorized = (error: string) => reply(401, error, {'WWW-Authenticate': 'Bearer realm="automatepal-mcp"'});
// Same rule as lib/origin.ts: no Origin (non-browser client) is fine; a browser Origin must be this app.
function originAllowed(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const expected = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  if (expected) { try { return origin === new URL(expected).origin; } catch { return false; } }
  try { return process.env.NODE_ENV !== 'production' && origin === new URL(req.url).origin; } catch { return false; }
}
export type McpHandlerDeps = McpToolDeps & {now?: () => number};
export function createMcpHandler(backend: McpBackend, deps: McpHandlerDeps = {}) {
  return async function handleMcp(req: Request): Promise<Response> {
    if (!originAllowed(req)) return reply(403, 'Invalid origin');
    if (req.method !== 'POST') return reply(405, 'Method not allowed. This MCP server is stateless: use POST.', {Allow: 'POST'});
    const token = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!token) return unauthorized('Send Authorization: Bearer <AutomatePal API token>.');
    const hash = createHash('sha256').update(token).digest('hex');
    if (!allowRequest('mcp:' + hash, (deps.now ?? Date.now)(), 30)) return reply(429, 'Rate limited. Try again in a minute.', {'Retry-After': '60'});
    let scope;
    try { scope = await backend.tokenScope(hash); } catch { return reply(503, 'Token check unavailable. Try again shortly.'); }
    if (!scope) return unauthorized('Token invalid, expired, revoked or without an MCP scope.');
    let parsedBody: unknown;
    try { parsedBody = await limitedJson(req, MCP_BODY_LIMIT); } catch (e) {
      return e instanceof Error && /too large/.test(e.message) ? reply(413, 'Request body too large (64 KB maximum).') : reply(400, 'Invalid JSON body.');
    }
    // One JSON-RPC message per request, so the per-token rate limit counts every call.
    if (Array.isArray(parsedBody)) return reply(400, 'Batch requests are not supported.');
    const server = buildMcpServer({scope, hash, backend, embed: deps.embed, answer: deps.answer});
    const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true});
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(req, {parsedBody});
      // JSON response mode: read the whole body before the server closes.
      const body = res.body ? await res.text() : null;
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(base)) headers.set(k, v);
      return new Response(body || null, {status: res.status, headers});
    } catch {
      return reply(500, 'MCP request failed.');
    } finally {
      await server.close().catch(() => undefined);
    }
  };
}
