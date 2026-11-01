// Context.dev fallback for pages that need a real browser (server-only). Used by lib/crawl.ts only when the
// owner opts in for a crawl, only for pages that returned too little text as plain HTML, and at most
// MAX_RENDERS_PER_CRAWL times per crawl, so paid credits are spent only where the free path failed.
// API: GET https://api.context.dev/v1/web/scrape/markdown (Bearer CONTEXT_DEV_API_KEY); response.markdown.
// The key is read from the environment only, never logged or returned.
import{importUrlProblem}from'./url-import';

export const MAX_RENDERS_PER_CRAWL=10;
const ENDPOINT='https://api.context.dev/v1/web/scrape/markdown';

export function contextDevAvailable(){return !!process.env.CONTEXT_DEV_API_KEY;}

/* Returns a render function bounded to `limit` calls, or null when no key is configured. */
export function contextDevRenderer(limit=MAX_RENDERS_PER_CRAWL,fetchImpl:typeof fetch=fetch){
 const key=process.env.CONTEXT_DEV_API_KEY;
 if(!key)return null;
 let used=0;
 const render=async(url:string):Promise<{markdown:string;title:string}|null>=>{
  if(used>=limit)return null;
  // Only public http(s) URLs: no credits spent on private or malformed addresses.
  if(importUrlProblem(url))return null;
  used++;
  const q=new URLSearchParams({url,useMainContentOnly:'true',includeLinks:'false',includeImages:'false'});
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),30000);
  try{
   const r=await fetchImpl(ENDPOINT+'?'+q.toString(),{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:ctrl.signal});
   if(!r.ok)return null;
   const d=await r.json() as {success?:boolean;markdown?:unknown;metadata?:{title?:unknown}};
   if(d.success===false||typeof d.markdown!=='string')return null;
   const title=typeof d.metadata?.title==='string'?d.metadata.title.slice(0,200):'';
   return{markdown:d.markdown,title};
  }catch{return null;}
  finally{clearTimeout(timer);}
 };
 return Object.assign(render,{used:()=>used});
}
