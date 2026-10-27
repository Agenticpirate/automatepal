import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
export const requestContext = new AsyncLocalStorage<{userId:string; email?:string; client:SupabaseClient}>();
export async function authenticate(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get('authorization');
  if (!url || !key || !auth?.startsWith('Bearer ')) return null;
  const client = createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const { data, error } = await client.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  return {userId:data.user.id,email:data.user.email,client};
}
