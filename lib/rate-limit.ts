import {createHash} from 'node:crypto';
import {serviceClient} from './service-db';
const windows = new Map<string, {count:number; until:number}>();
// Bounded per-process guard. Persisted knowledge quotas remain the costly-call boundary.
// First line of defence: cheap, no I/O, and the only guard when the shared one is unavailable.
export function allowLocal(userId:string,now=Date.now(),max=6) {
 if(userId.length>256)return false;
 if(windows.size>=5000){for(const [k,v] of windows)if(v.until<=now)windows.delete(k);}
 let window=windows.get(userId);
 if(!window||window.until<=now){
  if(!window&&windows.size>=5000)return false;
  window={count:0,until:now+60000};windows.set(userId,window);
 }
 window.count++;return window.count<=max;
}
const SHARED_DEADLINE_MS=1500;
/* Same limit, shared across processes and Cloudflare isolates through db/054 rate_limit_hit (service role).
   The local guard runs first, so a request refused locally never reaches the database. The key is hashed
   before it leaves the process. When the service key is not configured, or the database call fails or is
   slow, the local result stands: the limiter never blocks traffic because the counter store is down. */
export async function allowRequest(userId:string,now=Date.now(),max=6):Promise<boolean>{
 if(!allowLocal(userId,now,max))return false;
 const client=serviceClient();
 if(!client)return true;
 const key=createHash('sha256').update(userId).digest('hex');
 try{
  const r=await client.rpc('rate_limit_hit',{p_key:key,p_max:max,p_window_seconds:60}).abortSignal(AbortSignal.timeout(SHARED_DEADLINE_MS));
  return r.error?true:r.data!==false;
 }catch{return true;}
}
