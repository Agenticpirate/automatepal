export type DigestInteraction={id:string;created_at:string;question:string;supported:boolean;feedback:number|null};
export type DigestGroup={key:string;question:string;count:number;latestAt:string;negative:number};
export type UnansweredDigest={windowDays:number;windowStart:string;generatedAt:string;rowsConsidered:number;unansweredInWindow:number;groups:DigestGroup[];omittedGroups:number;excludedInvalid:number};
export const DIGEST_WINDOW_DAYS=7;
export const DIGEST_MAX_GROUPS=30;
export function normalizeQuestion(q:string){return q.trim().replace(/\s+/g,' ').toLowerCase();}
export function buildUnansweredDigest(rows:DigestInteraction[],now:Date=new Date()):UnansweredDigest{
  const nowMs=now.getTime();
  const windowStartMs=nowMs-DIGEST_WINDOW_DAYS*24*60*60*1000;
  let excludedInvalid=0;
  const inWindow:DigestInteraction[]=[];
  for(const r of rows){
    const t=Date.parse(r.created_at);
    if(!Number.isFinite(t)||t>nowMs){excludedInvalid++;continue;}
    if(t>=windowStartMs)inWindow.push(r);
  }
  const groups=new Map<string,DigestGroup>();
  let unansweredInWindow=0;
  for(const r of inWindow){
    if(r.supported)continue;
    unansweredInWindow++;
    const key=normalizeQuestion(r.question);
    const display=r.question.trim().replace(/\s+/g,' ');
    const g=groups.get(key);
    if(!g){groups.set(key,{key,question:display,count:1,latestAt:r.created_at,negative:r.feedback===-1?1:0});continue;}
    g.count++;
    if(r.feedback===-1)g.negative++;
    if(Date.parse(r.created_at)>Date.parse(g.latestAt)){g.latestAt=r.created_at;g.question=display;}
  }
  const sorted=[...groups.values()].sort((a,b)=>b.count-a.count||Date.parse(b.latestAt)-Date.parse(a.latestAt));
  return{windowDays:DIGEST_WINDOW_DAYS,windowStart:new Date(windowStartMs).toISOString(),generatedAt:now.toISOString(),rowsConsidered:inWindow.length,unansweredInWindow,groups:sorted.slice(0,DIGEST_MAX_GROUPS),omittedGroups:Math.max(0,sorted.length-DIGEST_MAX_GROUPS),excludedInvalid};
}
