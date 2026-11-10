/* Conversation transcripts (db/049): build, filter and export conversations from the loaded rows.
   Pure functions, shared by /api/history, the account-data export and the tests. */
import {csvCell} from './exports';
import {ticketLabel} from './tickets';

export type CaseRow={id:string;created_at:string;ticket_status:string;inbox_state:string;order_label:string};
export type QuestionRow={id:string;case_id:string;created_at:string;question:string;answer:string|null;source:string|null;supported:boolean;feedback:number|null};
export type MessageRow={id:string;case_id:string;created_at:string;author:string;body:string};
export type RequestRow={id:string;case_id:string;created_at:string;kind:string;message:string};
export type Entry={at:string;author:'visitor'|'ai'|'owner'|'request';text:string;meta?:string};
export type Conversation={id:string;label:string;created_at:string;last_at:string;status:string;inbox_state:string;source:string;questions:number;unanswered:number;preview:string;entries:Entry[];rating?:number};
export const SOURCES=['widget','hosted_page','api','mcp'] as const;
export const RETENTION_DAYS=[30,90,365] as const;

export function buildConversations(cases:CaseRow[],questions:QuestionRow[],messages:MessageRow[],requests:RequestRow[]):Conversation[]{
 const by=<T extends {case_id:string}>(rows:T[])=>{const m=new Map<string,T[]>();for(const r of rows){const l=m.get(r.case_id)??[];l.push(r);m.set(r.case_id,l);}return m;};
 const q=by(questions),m=by(messages),r=by(requests);
 return cases.map(c=>{
  const entries:Entry[]=[];
  for(const x of q.get(c.id)??[]){entries.push({at:x.created_at,author:'visitor',text:x.question});if(x.answer)entries.push({at:x.created_at,author:'ai',text:x.answer,meta:(x.supported?'answered from sources':'not answered from sources')+(x.feedback===1?' · rated helpful':x.feedback===-1?' · rated not helpful':'')});}
  for(const x of m.get(c.id)??[])entries.push({at:x.created_at,author:x.author==='owner'?'owner':'visitor',text:x.body,meta:'person chat'});
  for(const x of r.get(c.id)??[])entries.push({at:x.created_at,author:'request',text:x.message,meta:x.kind.replace(/_/g,' ')});
  entries.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||order(a.author)-order(b.author));
  const qs=q.get(c.id)??[];
  const first=[...qs].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))[0];
  const last=entries.length?entries[entries.length-1].at:c.created_at;
  return{id:c.id,label:ticketLabel(c.id),created_at:c.created_at,last_at:Date.parse(last)>Date.parse(c.created_at)?last:c.created_at,status:c.ticket_status,inbox_state:c.inbox_state,source:first?.source??'widget',questions:qs.length,unanswered:qs.filter(x=>!x.supported).length,preview:(entries.find(e=>e.author==='visitor')?.text??c.order_label).slice(0,160),entries};
 }).sort((a,b)=>Date.parse(b.last_at)-Date.parse(a.last_at));
}
const order=(a:Entry['author'])=>({visitor:0,ai:1,request:2,owner:3})[a];

export type Filter={q?:string;from?:string;to?:string;status?:string;source?:string};
/* Plain case-insensitive substring search over the transcript text and the ticket label (no patterns).
   from/to are UTC days (YYYY-MM-DD), inclusive, on the conversation's last activity. */
export function filterConversations(list:Conversation[],f:Filter):Conversation[]{
 const needle=(f.q??'').trim().toLowerCase();
 const from=f.from&&/^\d{4}-\d{2}-\d{2}$/.test(f.from)?Date.parse(f.from+'T00:00:00Z'):null;
 const to=f.to&&/^\d{4}-\d{2}-\d{2}$/.test(f.to)?Date.parse(f.to+'T00:00:00Z')+86400000:null;
 return list.filter(c=>{
  const t=Date.parse(c.last_at);
  if(from!==null&&t<from)return false;
  if(to!==null&&t>=to)return false;
  if(f.status&&f.status!=='all'&&c.status!==f.status)return false;
  if(f.source&&f.source!=='all'&&c.source!==f.source)return false;
  if(needle&&!(c.label.toLowerCase().includes(needle)||c.id.includes(needle)||c.entries.some(e=>e.text.toLowerCase().includes(needle))))return false;
  return true;
 });
}
/* One row per transcript entry. csvCell escapes = + - @ tab and CR at the start of a cell and doubles quotes. */
export function transcriptsCsv(list:Conversation[]):string{
 const rows=['Conversation,Full ID,Status,Source,Time UTC,Author,Text,Note'];
 for(const c of list)for(const e of c.entries)rows.push([c.label,c.id,c.status,c.source,e.at,e.author,e.text,e.meta??''].map(csvCell).join(','));
 return rows.join('\n');
}
