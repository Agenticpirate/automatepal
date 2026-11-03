/* Email via Resend (plain fetch to https://api.resend.com/emails, no SDK). Server-only.
   Transport is OFF unless RESEND_API_KEY is set: without it every send is still reserved and logged, then
   finished as a dry run, and the caller gets {status:'dry_run'}; it is never an error for the user.
   Every send is reserved first (db/048 email_reserve*): the database applies the workspace's email settings
   and per-workspace caps and writes a metadata-only row (type, sha256 of the address, status, provider id)
   plus an audit row. If the reservation cannot be recorded, nothing is sent.
   Content rules: owner alerts and new-lead notices carry no visitor text and no visitor address, only a
   ticket label and a link. The weekly digest (owner only) may quote unanswered questions, which is visitor
   text shown to the workspace's own owner. A visitor email carries only the owner's reply text. */
import {createHash} from 'node:crypto';
import {z} from 'zod';import './zod-csp';
import type {SupabaseClient} from '@supabase/supabase-js';
import {serviceClient} from './service-db';
import {ticketLabel} from './tickets';
import {SITE_URL} from './site';

export type EmailType='owner_alert'|'weekly_digest'|'new_lead'|'team_invite'|'visitor_reply';
export type EmailMessage={type:EmailType;to:string;subject:string;text:string};
export type EmailStatus='sent'|'dry_run'|'failed'|'suppressed_cap'|'suppressed_off'|'not_recorded'|'invalid';
export type EmailOutcome={status:EmailStatus;id?:string;providerId?:string};
export type Reservation={id:string;allowed:boolean;status:string};
export type EmailStore={reserve(type:EmailType,recipientHash:string):Promise<Reservation|null>;finish(id:string,status:'sent'|'dry_run'|'failed',providerId:string|null):Promise<boolean>};
export type EmailDeps={fetch?:typeof fetch;env?:Record<string,string|undefined>;timeoutMs?:number};

export const RESEND_URL='https://api.resend.com/emails';
const PROVIDER_ID=/^[A-Za-z0-9_-]{1,100}$/;
const address=z.string().trim().toLowerCase().email().max(254);
export const recipientHash=(to:string)=>createHash('sha256').update(to.trim().toLowerCase()).digest('hex');
export const appUrl=()=>{try{return new URL(process.env.APP_URL||SITE_URL).origin;}catch{return SITE_URL;}};

/* "Name <local@domain>" or a bare address. Anything else (or a CR/LF) is refused. */
export function emailFrom(env:Record<string,string|undefined>=process.env):string|null{
 const v=(env.EMAIL_FROM??'').trim();if(!v||/[\r\n]/.test(v)||v.length>200)return null;
 const m=v.match(/^(?:([^<>"]{1,80})\s+)?<([^<>\s]+)>$/)??v.match(/^()([^<>\s]+)$/);
 if(!m||!address.safeParse(m[2]).success)return null;
 return v;
}
/* Optional bare reply-to address (EMAIL_REPLY_TO), for a sender address with no mailbox behind it. */
export function emailReplyTo(env:Record<string,string|undefined>=process.env):string|null{
 const v=(env.EMAIL_REPLY_TO??'').trim();if(!v||/[\r\n]/.test(v))return null;
 const p=address.safeParse(v);return p.success?p.data:null;
}
export function emailTransport(env:Record<string,string|undefined>=process.env):'resend'|'dry_run'{
 return env.RESEND_API_KEY&&emailFrom(env)?'resend':'dry_run';
}

/* One send. Never throws. */
export async function deliver(store:EmailStore,msg:EmailMessage,deps:EmailDeps={}):Promise<EmailOutcome>{
 const env=deps.env??process.env;
 const to=address.safeParse(msg.to);
 if(!to.success||!msg.subject||msg.subject.length>200||/[\r\n]/.test(msg.subject)||!msg.text||msg.text.length>20000)return{status:'invalid'};
 let r:Reservation|null=null;
 try{r=await store.reserve(msg.type,recipientHash(to.data));}catch{r=null;}
 if(!r)return{status:'not_recorded'};
 if(!r.allowed)return{status:(r.status==='suppressed_off'?'suppressed_off':'suppressed_cap'),id:r.id};
 const finish=async(status:'sent'|'dry_run'|'failed',providerId:string|null)=>{try{await store.finish(r!.id,status,providerId);}catch{/* the row stays 'reserved'; caps still count it */}};
 if(emailTransport(env)==='dry_run'){await finish('dry_run',null);return{status:'dry_run',id:r.id};}
 const f=deps.fetch??fetch,ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),deps.timeoutMs??8000);
 try{
  const res=await f(RESEND_URL,{method:'POST',redirect:'error',signal:ctrl.signal,headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':r.id},
   body:JSON.stringify({from:emailFrom(env),to:[to.data],subject:msg.subject,text:msg.text,...(emailReplyTo(env)?{reply_to:emailReplyTo(env)}:{})})});
  const body=await res.json().catch(()=>null) as {id?:unknown}|null;
  const id=typeof body?.id==='string'&&PROVIDER_ID.test(body.id)?body.id:null;
  if(res.ok&&id){await finish('sent',id);return{status:'sent',id:r.id,providerId:id};}
  await finish('failed',null);return{status:'failed',id:r.id};
 }catch{await finish('failed',null);return{status:'failed',id:r.id};}
 finally{clearTimeout(timer);}
}

/* Stores. Service role for server jobs and visitor-triggered alerts; the signed-in client for invites and
   replies (the database checks the role and the acting workspace). */
export function serviceEmailStore(client:SupabaseClient,workspace:string):EmailStore{
 return{
  async reserve(type,hash){const {data,error}=await client.rpc('email_reserve',{p_ws:workspace,p_type:type,p_recipient_hash:hash});return error||!data?null:data as Reservation;},
  async finish(id,status,providerId){const {data,error}=await client.rpc('email_finish',{p_id:id,p_status:status,p_provider_id:providerId});return !error&&data===true;},
 };
}
export function memberEmailStore(client:SupabaseClient):EmailStore{
 return{
  async reserve(type,hash){const {data,error}=await client.rpc('email_reserve_member',{p_type:type,p_recipient_hash:hash});return error||!data?null:data as Reservation;},
  async finish(id,status,providerId){const {data,error}=await client.rpc('email_finish_member',{p_id:id,p_status:status,p_provider_id:providerId});return !error&&data===true;},
 };
}

/* ---------- Templates (plain text) ---------- */
const OWNER_FOOTER=(base:string)=>`\n\n--\nYou get this because you own an AutomatePal workspace. Turn these emails off in Overview > Email notifications: ${base}/owner#email-settings`;
export function ownerAlertEmail(to:string,caseId:string,kind:'handoff'|'refund_review',base=appUrl()):EmailMessage{
 const what=kind==='handoff'?'A visitor asked to talk to a person':'A refund review was opened';
 return{type:'owner_alert',to,subject:`${what} (${ticketLabel(caseId)})`,
  text:`${what} in conversation ${ticketLabel(caseId)}.\n\nOpen it in Tickets: ${base}/tickets?ticket=${caseId}\n\nThis email does not include the visitor's message. Nothing has been refunded or sent to the visitor.`+OWNER_FOOTER(base)};
}
export function newLeadEmail(to:string,caseId:string,base=appUrl()):EmailMessage{
 return{type:'new_lead',to,subject:`New lead in conversation ${ticketLabel(caseId)}`,
  text:`A visitor left contact details with consent in conversation ${ticketLabel(caseId)}.\n\nSee it on the Leads page: ${base}/leads\n\nThe address and message are only shown in your dashboard, not in this email.`+OWNER_FOOTER(base)};
}
export type DigestData={questions:number;questionsPrev:number;answered:number;answeredPrev:number;handoffs:number;handoffsPrev:number;leads:number;leadsPrev:number;topUnanswered:{question:string;count:number}[]};
export function weekOverWeek(now:number,prev:number):string{
 if(prev===0)return now===0?'no change':'new this week';
 const pct=Math.round(100*(now-prev)/prev);return pct===0?'no change':(pct>0?'+':'')+pct+'% vs the week before';
}
/* Single line, no control characters, at most 200 characters. */
const oneLine=(s:string)=>s.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
export function weeklyDigestEmail(to:string,d:DigestData,base=appUrl()):EmailMessage{
 const rate=(a:number,q:number)=>q?Math.round(100*a/q)+'%':'n/a';
 const lines=[
  'Your AutomatePal week (last 7 days):','',
  `Questions asked: ${d.questions} (${weekOverWeek(d.questions,d.questionsPrev)})`,
  `Answered from your sources: ${d.answered}, ${rate(d.answered,d.questions)} (the week before: ${rate(d.answeredPrev,d.questionsPrev)})`,
  `Asked for a person: ${d.handoffs} (${weekOverWeek(d.handoffs,d.handoffsPrev)})`,
  `Leads with consent: ${d.leads} (${weekOverWeek(d.leads,d.leadsPrev)})`,'',
  d.topUnanswered.length?'Top unanswered questions:':'No unanswered questions this week.',
  ...d.topUnanswered.slice(0,5).map((q,i)=>`${i+1}. ${oneLine(q.question)} (${q.count}x)`),'',
  `Write answers for them in Knowledge: ${base}/knowledge`,
 ];
 return{type:'weekly_digest',to,subject:`Your AutomatePal week: ${d.questions} questions, ${d.answered} answered`,text:lines.join('\n')+OWNER_FOOTER(base)};
}
export function teamInviteEmail(to:string,link:string,role:string):EmailMessage{
 return{type:'team_invite',to,subject:'You are invited to an AutomatePal workspace',
  text:`You have been invited to join an AutomatePal workspace as ${role}.\n\nAccept the invite (it works once, for 7 days, and only when you sign in with this address):\n${link}\n\nIf you did not expect this, ignore this email.`};
}
export function visitorReplyEmail(to:string,reply:string):EmailMessage{
 return{type:'visitor_reply',to,subject:'A reply to your support request',
  text:`${reply.slice(0,1000)}\n\n--\nYou get this because you left this address, with consent, in a support chat. Replies to this email are not read; continue in the chat.`};
}

/* ---------- Triggers ---------- */
/* Visitor-triggered owner email (handoff, refund review, new lead). Service role only; without it the event
   is not emailed and one metadata line is logged. Never throws. */
export async function notifyOwner(caseHash:string,event:'handoff'|'refund_review'|'lead',deps:EmailDeps&{client?:SupabaseClient|null}={}):Promise<EmailOutcome>{
 try{
  const client=deps.client===undefined?serviceClient():deps.client;
  if(!client){console.info(JSON.stringify({event:'email_skipped',reason:'SUPABASE_SERVICE_ROLE_KEY not set',type:event==='lead'?'new_lead':'owner_alert'}));return{status:'not_recorded'};}
  const ref=await client.rpc('service_case_ref',{p_hash:caseHash});
  const ws=(ref.data as {workspace?:string;caseId?:string}|null);
  if(ref.error||!ws?.workspace||!ws.caseId)return{status:'not_recorded'};
  const owner=await client.rpc('service_owner_email',{p_ws:ws.workspace});
  if(owner.error||typeof owner.data!=='string')return{status:'not_recorded'};
  const msg=event==='lead'?newLeadEmail(owner.data,ws.caseId):ownerAlertEmail(owner.data,ws.caseId,event);
  return await deliver(serviceEmailStore(client,ws.workspace),msg,deps);
 }catch{return{status:'not_recorded'};}
}
