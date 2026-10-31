import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'agent';
const RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, manager: 2, agent: 1 };
export const roleAtLeast = (role: WorkspaceRole, min: WorkspaceRole) => RANK[role] >= RANK[min];

// userId is the WORKSPACE id (the owner's auth id), so every tenant-scoped query keeps working.
// actorId is the signed-in person; role is their role in that workspace.
export type Session = { userId: string; actorId: string; role: WorkspaceRole; email?: string; client: SupabaseClient; actionId?: string };
// Store type keeps actor/role optional so older callers and fixtures that only set userId still type-check.
export const requestContext = new AsyncLocalStorage<Omit<Session, 'actorId' | 'role'> & Partial<Pick<Session, 'actorId' | 'role'>>>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function authenticate(req: NextRequest): Promise<Session | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization');
  if (!url || !key || !auth?.startsWith('Bearer ')) return null;
  if (auth.length > 8192) return null;
  const wsHeader = req.headers.get('x-workspace-id');
  if (wsHeader !== null && !UUID.test(wsHeader)) return null;
  try {
    const headers: Record<string, string> = { Authorization: auth };
    if (wsHeader) headers['x-workspace-id'] = wsHeader.toLowerCase();
    const client = createClient(url, key, { global: { headers }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(auth.slice(7));
    if (error || !data.user || !data.user.email_confirmed_at) return null;
    const me = data.user.id;
    if (!wsHeader || wsHeader.toLowerCase() === me) return { userId: me, actorId: me, role: 'owner', email: data.user.email, client };
    // Acting in someone else's workspace: the database validates membership (fails closed).
    const ctx = await client.rpc('workspace_context');
    const row = Array.isArray(ctx.data) ? ctx.data[0] : null;
    if (ctx.error || !row?.workspace_id || !(row.role in RANK)) return null;
    return { userId: row.workspace_id, actorId: me, role: row.role as WorkspaceRole, email: data.user.email, client };
  } catch { return null; }
}

// Signed-in user without workspace resolution: for listing workspaces and accepting invites.
export async function authenticateUser(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization');
  if (!url || !key || !auth?.startsWith('Bearer ') || auth.length > 8192) return null;
  try {
    const client = createClient(url, key, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(auth.slice(7));
    if (error || !data.user || !data.user.email_confirmed_at) return null;
    return { actorId: data.user.id, email: data.user.email, client };
  } catch { return null; }
}
