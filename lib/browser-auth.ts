import { createClient } from '@supabase/supabase-js';
let client: ReturnType<typeof createClient> | undefined;
export function browserAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url,key);
  return client;
}
// The workspace the signed-in person is acting in. Absent means their own workspace.
const WS_KEY = 'ap-workspace';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function selectedWorkspace(): string | null {
  try { const v = localStorage.getItem(WS_KEY); return v && UUID.test(v) ? v : null; } catch { return null; }
}
export function selectWorkspace(id: string | null) {
  try { if (id) localStorage.setItem(WS_KEY, id); else localStorage.removeItem(WS_KEY); } catch {}
}
export async function authHeaders(): Promise<Record<string, string>> {
  const session = await browserAuth()?.auth.getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.data.session?.access_token ?? ''}` };
  const ws = selectedWorkspace();
  if (ws) headers['x-workspace-id'] = ws;
  return headers;
}
