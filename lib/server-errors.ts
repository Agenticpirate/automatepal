/* Server error monitoring (server-only), called from instrumentation.ts onRequestError.
   Records metadata only: the route template (for example /api/support or /tickets), the router context, the
   release and a request id. Never the request path with its query, headers, bodies or the error message,
   which can carry visitor text or tokens. Each error becomes one JSON line in the server log and, when
   SUPABASE_SERVICE_ROLE_KEY is set, one SERVER_ERROR row in the operational log (db/048).
   Optional ALERT_WEBHOOK_URL (https only): one POST when BURST errors happen within WINDOW_MS, then at most
   one more per COOLDOWN_MS. In-process counters, so each server instance alerts on its own. */
import {randomUUID} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {serviceClient} from './service-db';

export const BURST=5,WINDOW_MS=5*60_000,COOLDOWN_MS=15*60_000;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const release=()=>((process.env.APP_REVISION||process.env.RENDER_GIT_COMMIT)?.slice(0,12)||'local').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40)||'local';
/* A route template, never a concrete URL: route files like /app/tickets/page become /tickets. */
export function routeTemplate(routePath:string|undefined):string{
 const r=(routePath??'').replace(/^\/?app/,'').replace(/\/(page|route|layout)$/,'')||'/';
 const clean=r.replace(/[^A-Za-z0-9_/\[\]().@-]/g,'').slice(0,200);
 return clean.startsWith('/')?clean:'/'+clean;
}
export type ErrorInfo={routePath?:string;routeType?:string;method?:string;requestId?:string|null};
type Deps={client?:SupabaseClient|null;fetch?:typeof fetch;now?:()=>number;log?:(line:string)=>void;env?:Record<string,string|undefined>};
const recent:number[]=[];let lastAlert=0;
export function resetServerErrorState(){recent.length=0;lastAlert=0;}

export function webhookUrl(env:Record<string,string|undefined>=process.env):string|null{
 const v=env.ALERT_WEBHOOK_URL;if(!v)return null;
 try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.toString():null;}catch{return null;}
}

export async function recordServerError(info:ErrorInfo,deps:Deps={}):Promise<{requestId:string;stored:boolean;alerted:boolean}>{
 const now=(deps.now??Date.now)(),env=deps.env??process.env;
 const requestId=info.requestId&&UUID.test(info.requestId)?info.requestId.toLowerCase():randomUUID();
 const route=routeTemplate(info.routePath),rel=release();
 const routeType=['render','route','action','proxy'].includes(info.routeType??'')?info.routeType:'unknown';
 const method=/^[A-Z]{3,7}$/.test(info.method??'')?info.method:'unknown';
 (deps.log??((l:string)=>console.error(l)))(JSON.stringify({event:'server_error',route,routeType,method,release:rel,requestId}));
 let stored=false;
 try{const c=deps.client===undefined?serviceClient():deps.client;if(c){const r=await c.rpc('record_server_error',{p_request:requestId,p_route:route,p_release:rel});stored=!r.error;}}catch{/* logging never throws */}
 recent.push(now);while(recent.length&&recent[0]<now-WINDOW_MS)recent.shift();
 let alerted=false;const hook=webhookUrl(env);
 if(hook&&recent.length>=BURST&&now-lastAlert>=COOLDOWN_MS){
  lastAlert=now;
  const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),5000);
  try{const r=await (deps.fetch??fetch)(hook,{method:'POST',redirect:'manual',signal:ctrl.signal,headers:{'Content-Type':'application/json'},
   body:JSON.stringify({text:`AutomatePal: ${recent.length} server errors in the last ${WINDOW_MS/60000} minutes (release ${rel}, latest route ${route}).`,count:recent.length,windowMinutes:WINDOW_MS/60000,release:rel,route})});alerted=r.ok;}
  catch{/* alert delivery is best effort */}finally{clearTimeout(t);}
 }
 return{requestId,stored,alerted};
}
