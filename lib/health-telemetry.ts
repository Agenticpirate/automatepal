// Derived from operational_summary groups only: real recorded counters, never estimates.
export type HealthGroup={code:string;severity:string;component:string;count:number;latest:string};
export type HealthTelemetry={events24h:number;errors24h:number;errorRate24h:number;failedJobs24h:Record<string,{count:number;latest:string}>;autoFix24h:{started:number;recovered:number;exhausted:number;recoveryRate:number|null;log:{code:string;count:number;latest:string}[]}};
export function healthTelemetry(groups:HealthGroup[]|null|undefined):HealthTelemetry{
 const g=(Array.isArray(groups)?groups:[]).map(x=>({code:String(x.code),severity:String(x.severity),component:String(x.component),count:Number(x.count)||0,latest:String(x.latest??'')}));
 const events24h=g.reduce((n,x)=>n+x.count,0);
 const errors24h=g.filter(x=>x.severity==='error').reduce((n,x)=>n+x.count,0);
 const failedJobs24h:Record<string,{count:number;latest:string}>={};
 for(const x of g)if(x.code.endsWith('_FAILED'))failedJobs24h[x.code]={count:x.count,latest:x.latest};
 const sum=(code:string)=>g.filter(x=>x.code===code).reduce((n,x)=>n+x.count,0);
 const started=sum('SAFE_RETRY_STARTED'),recovered=sum('SAFE_RETRY_RECOVERED'),exhausted=sum('SAFE_RETRY_EXHAUSTED');
 const log=g.filter(x=>x.code.startsWith('SAFE_RETRY_')).map(x=>({code:x.code,count:x.count,latest:x.latest}));
 return {events24h,errors24h,errorRate24h:events24h?Math.round(10000*errors24h/events24h)/10000:0,
  failedJobs24h,
  autoFix24h:{started,recovered,exhausted,recoveryRate:started?Math.round(10000*recovered/started)/10000:null,log}};
}
// Fields the health token cannot read without a live Supabase change. Listed explicitly so watchers never guess.
export const healthUnavailable={answerLatencyPercentiles:'Not recorded anywhere yet. Needs a latency counter store and an operational_summary extension; pending owner approval for a live Supabase change.',quotaUsage:'Knowledge answer/source quotas are readable by the owner session only. Exposing them to health:read tokens needs an operational_summary extension; pending owner approval.'} as const;
