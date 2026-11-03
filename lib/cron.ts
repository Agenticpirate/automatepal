/* Scheduled jobs behind POST /api/cron/refresh (server-only). The GitHub Actions workflow
   .github/workflows/scheduled-refresh.yml calls it hourly; this code decides what is due. Each call does a
   bounded amount of work inside one time budget, in this order:
   1. transcript retention purge (db/049), up to 200 conversations;
   2. website refresh for up to 2 due workspaces (db/050, lib/refresh.ts);
   3. AI insights for up to 10 conversations (db/051, lib/insights.ts);
   4. weekly digests for up to 10 workspaces (db/048, lib/email.ts).
   A failing job is reported and the next one still runs. */
import {createHash,timingSafeEqual} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {refreshWorkspace,type RefreshDeps} from './refresh';
import {labelBatch,type InsightItem,type LabelDeps} from './insights';
import {deliver,serviceEmailStore,weeklyDigestEmail,type DigestData,type EmailDeps} from './email';

/* Bearer CRON_SECRET (at least 32 characters), compared in constant time over SHA-256 digests. */
export function cronAuthorized(header:string|null,secret:string|undefined=process.env.CRON_SECRET):boolean{
 if(!secret||secret.length<32||!header||!header.startsWith('Bearer ')||header.length>600)return false;
 const a=createHash('sha256').update(header.slice(7)).digest(),b=createHash('sha256').update(secret).digest();
 return timingSafeEqual(a,b);
}

export type JobResult={ok:boolean;[k:string]:unknown};
export type CronDeps={refresh?:RefreshDeps;insights?:LabelDeps;email?:EmailDeps;now?:()=>number};
export async function runScheduledJobs(client:SupabaseClient,budgetMs=50_000,deps:CronDeps={}):Promise<Record<string,JobResult>>{
 const now=deps.now??Date.now,deadline=now()+budgetMs,left=()=>deadline-now();
 const out:Record<string,JobResult>={};
 // 1. Retention purge.
 try{const r=await client.rpc('purge_expired_transcripts',{p_limit:200});out.purge=r.error?{ok:false}:{ok:true,deleted:Number(r.data)||0};}catch{out.purge={ok:false};}
 // 2. Website refresh, at most 2 workspaces, each with its own share of the time left.
 try{
  const due=left()>15_000?await client.rpc('service_refresh_claim',{p_limit:2}):{data:[],error:null};
  if(due.error)out.refresh={ok:false};
  else{
   const jobs=(due.data??[]) as {workspace:string;sitemapUrl:string|null}[];const runs:unknown[]=[];let failed=0;
   for(const [i,job] of jobs.entries()){
    const share=Math.min(deadline-12_000,now()+Math.max(5_000,(left()-12_000)/(jobs.length-i)));
    try{runs.push((await refreshWorkspace(client,job,share,deps.refresh)).summary);}catch{failed++;}
   }
   out.refresh={ok:failed===0,workspaces:jobs.length,failed,runs};
  }
 }catch{out.refresh={ok:false};}
 // 3. Insights.
 try{
  if(left()<8_000)out.insights={ok:true,skipped:'time'};
  else{
   const p=await client.rpc('service_insights_pending',{p_limit:10});
   if(p.error)out.insights={ok:false};
   else{
    const r=await labelBatch((p.data??[]) as InsightItem[],{...deps.insights,deadline:deadline-4_000});
    const saved=r.labels.length?await client.rpc('service_insights_record',{p_items:r.labels}):{data:0,error:null};
    out.insights={ok:!saved.error,labeled:Number(saved.data)||0,failed:r.failed,...(r.stopped?{stopped:r.stopped}:{})};
   }
  }
 }catch{out.insights={ok:false};}
 // 4. Weekly digests.
 try{
  if(left()<3_000)out.digest={ok:true,skipped:'time'};
  else{
   const due=await client.rpc('service_digest_due',{p_limit:10});
   if(due.error)out.digest={ok:false};
   else{
    const counts:Record<string,number>={};
    for(const ws of (due.data??[]) as string[]){
     if(left()<2_000)break;
     const [d,owner]=await Promise.all([client.rpc('service_weekly_digest',{p_ws:ws}),client.rpc('service_owner_email',{p_ws:ws})]);
     if(d.error||!d.data||owner.error||typeof owner.data!=='string'){counts.skipped=(counts.skipped??0)+1;continue;}
     const r=await deliver(serviceEmailStore(client,ws),weeklyDigestEmail(owner.data,d.data as DigestData),deps.email);
     counts[r.status]=(counts[r.status]??0)+1;
    }
    out.digest={ok:true,...counts};
   }
  }
 }catch{out.digest={ok:false};}
 return out;
}
