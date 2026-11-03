/* Server-side transcript loader for /api/history and the account-data export. Reads through the signed-in
   client, so row-level security limits it to the acting workspace (agents and up). */
import type {Session} from './session';
import {buildConversations,type CaseRow,type QuestionRow,type MessageRow,type RequestRow} from './transcripts';
/* Case ids go into the request URL (`case_id=in.(...)`). The local gateway answers 414 URI too long at 300
   ids, so child rows are read in batches of at most ID_BATCH ids and merged. */
export const ID_BATCH=100;
export const batches=<T>(xs:T[],size=ID_BATCH)=>Array.from({length:Math.ceil(xs.length/size)},(_,i)=>xs.slice(i*size,(i+1)*size));
type Read={data:unknown[]|null;error:unknown};
async function readAll(ids:string[],read:(chunk:string[])=>PromiseLike<Read>):Promise<{rows:unknown[];error:boolean}>{
 const parts=await Promise.all(batches(ids).map(chunk=>read(chunk)));
 return {rows:parts.flatMap(p=>p.data??[]),error:parts.some(p=>!!p.error)};
}
const byTime=(a:{created_at:string},b:{created_at:string})=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:0;
export async function loadConversations(c:Pick<Session,'client'|'userId'>,limit=300){
 const cases=await c.client.from('support_cases').select('id,created_at,ticket_status,inbox_state,order_label').eq('user_id',c.userId).order('ticket_updated_at',{ascending:false}).limit(limit);
 if(cases.error)return null;
 const ids=(cases.data??[]).map(x=>x.id as string);
 if(!ids.length)return {conversations:[],truncated:false};
 const [q,m,r]=await Promise.all([
  readAll(ids,chunk=>c.client.from('knowledge_interactions').select('id,case_id,created_at,question,answer,source,supported,feedback').eq('user_id',c.userId).in('case_id',chunk).order('created_at',{ascending:true}).limit(5000)),
  readAll(ids,chunk=>c.client.from('support_messages').select('id,case_id,created_at,author,body').eq('user_id',c.userId).in('case_id',chunk).order('created_at',{ascending:true}).limit(5000)),
  readAll(ids,chunk=>c.client.from('support_requests').select('id,case_id,created_at,kind,message').eq('user_id',c.userId).in('case_id',chunk).order('created_at',{ascending:true}).limit(2000)),
 ]);
 if(q.error||r.error)return null;
 const sorted=<T extends {created_at:string}>(rows:unknown[])=>(rows as T[]).sort(byTime);
 return {conversations:buildConversations(cases.data as CaseRow[],sorted<QuestionRow>(q.rows),(m.error?[]:sorted<MessageRow>(m.rows)),sorted<RequestRow>(r.rows)),truncated:(cases.data?.length??0)>=limit};
}
