/* Server-only Supabase client with the service role, for scheduled jobs and server-side bookkeeping that has
   no signed-in user: the cron job, visitor-triggered owner alerts and server-error rows. Returns null when
   SUPABASE_SERVICE_ROLE_KEY is not set; every caller then skips its work (it never falls back to another key).
   The key must never reach the browser: it is read here only, and this module is imported only by route
   handlers, lib/email.ts, lib/server-errors.ts and the cron job. */
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
let cached:SupabaseClient|null|undefined;
export function serviceClient():SupabaseClient|null{
 if(cached!==undefined)return cached;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 cached=url&&key?createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
 return cached;
}
/* Tests only. */
export function resetServiceClient(){cached=undefined;}
