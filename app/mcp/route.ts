import {supabaseMcpBackend} from '../../lib/mcp/backend';
import {createMcpHandler} from '../../lib/mcp/http';
// MCP server (Streamable HTTP, stateless). Bearer: an AutomatePal API token with an MCP scope.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handler = createMcpHandler(supabaseMcpBackend());
export async function POST(req: Request) { return handler(req); }
export async function GET(req: Request) { return handler(req); }
export async function DELETE(req: Request) { return handler(req); }
