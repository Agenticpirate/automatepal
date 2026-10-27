import { createClient } from '@supabase/supabase-js';
let client: ReturnType<typeof createClient> | undefined;
export function browserAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url,key);
  return client;
}
export async function authHeaders() {
  const session = await browserAuth()?.auth.getSession();
  return {Authorization:`Bearer ${session?.data.session?.access_token ?? ''}`};
}
