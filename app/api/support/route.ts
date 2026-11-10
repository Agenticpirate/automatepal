import{demoGate,demoLocked}from'../../../lib/demo-open';
import {knowledgeDiagnostic} from '../../../lib/telemetry';
import {billingPreview} from '../../../lib/billing-preview';
import{widgetSettings}from'../../../lib/widget';
import{isOpenNow,workingHours,DEFAULT_AWAY_MESSAGE}from'../../../lib/working-hours';
import{messageBody}from'../../../lib/support-messages';
import{PROMPT_INJECTION_REFUSAL,promptInjection}from'../../../lib/prompt-guard';
import{limitedJson}from'../../../lib/limited-json';
import{modeText}from'../../../lib/app-mode';
import { NextRequest,NextResponse,after } from 'next/server';
import {deliverDueWebhooks} from '../../../lib/webhook-worker';
import {notifySlack} from '../../../lib/slack';
import {notifyPush} from '../../../lib/push-notify';
import {botParam,rpcBot} from '../../../lib/bots';
import {isInternal} from '../../../lib/internal-call';
import {clientIp} from '../../../lib/widget-frame';
import {serviceClient} from '../../../lib/service-db';
import { createClient } from '@supabase/supabase-js';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import {answerKnowledge,safeKnowledge,embedKnowledge,exactCustomAnswer,instructionExtraction} from '../../../lib/knowledge';
import { z } from 'zod';
import {authenticate} from '../../../lib/session';import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
import {billingIntent} from '../../../lib/billing/core/intent';
import {enabledDefinition,visitorBillingSupport} from '../../../lib/billing/core/registry';
import {answerBilling,requestRefundReview,verifyVisitor,VERIFY_REQUIRED} from '../../../lib/billing/core/service';
import {supabaseBillingStore} from '../../../lib/billing/core/store-supabase';
import {safeErrorMessage} from '../../../lib/billing/core/redact';
import type {BillingProviderId} from '../../../lib/billing/core/types';
import {notifyOwner} from '../../../lib/email';
/* Where a question was asked: the embedded widget or the hosted /help page. */
const sourceSchema=z.enum(['widget','hosted_page']).default('widget');
/* Transcript (db/049): store the answer the visitor saw. Fail soft: an un-migrated database keeps working. */
async function recordAnswer(token:string,id:unknown,answer:unknown,source:string){if(typeof id!=='string'||typeof answer!=='string'||!answer.trim())return;try{await publicClient().rpc('support_record_answer',{p_hash:hash(token),p_id:id,p_answer:answer,p_source:source});}catch{/* transcript is best effort */}}
/* Owner email (db/048, lib/email.ts) runs after the response is decided and never blocks or fails the visitor. */
/* Owner email, Slack and device push run after the response is sent (next/server after, also on Workers). */
const alertOwner=(token:string,event:'handoff'|'refund_review'|'lead')=>{const h=hash(token);after(()=>Promise.all([notifyOwner(h,event),notifySlack(h,event),notifyPush(h,event)]).then(()=>{},()=>{}));};
const tokenSchema=z.string().regex(/^[a-f0-9]{64}$/);
const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
const B62='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
// 24 unbiased base62 characters (rejection sampling), about 143 bits.
function newWidgetKey(mode:'live'|'test'){let out='';while(out.length<24){for(const b of randomBytes(32)){if(b<248&&out.length<24)out+=B62[b%62];}}return `pk_${mode}_${out}`;}
function publicClient(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});}
export async function GET(req:NextRequest){
 const token=req.nextUrl.searchParams.get('token');
 if(token){const parsed=tokenSchema.safeParse(token);if(!parsed.success)return NextResponse.json({error:'Invalid demo link.'},{status:400});
  const {data,error}=await publicClient().rpc('support_case_view',{p_hash:hash(token)});
  // Separate fail-soft read: on an un-migrated database or no enabled connection the key is omitted.
  const billingSupport=error||!data?null:await supabaseBillingStore(publicClient()).status(hash(token)).then(visitorBillingSupport).catch(()=>null);
  return NextResponse.json(error||!data?{error:modeText('This fictional demo link is unavailable or expired.','This chat link is unavailable or expired.')}:{case:{...data,billing:billingPreview(data),...(billingSupport?{billingSupport}:{})}},{status:error||!data?404:200,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 const ctx=await authenticate(req);if(!ctx){const d=demoGate(req,'support');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 const {data,error}=await ctx.client.from('support_requests').select('id,case_id,created_at,kind,message,status,contact_email,contact_consent').eq('user_id',ctx.userId).order('created_at',{ascending:false}).limit(100);
 const cases=await ctx.client.from('support_cases').select('id,created_at,expires_at,order_label,inbox_state').eq('user_id',ctx.userId).order('created_at',{ascending:false}).limit(100);
 // Key columns arrive with db/055; on a database without them, fall back to the settings alone.
 const bot=botParam(req.nextUrl.searchParams.get('bot'),ctx.userId);
 let settings:{data:{label:string;color:string;initials:string;prompts:string[];controls:Record<string,unknown>;public_key?:string|null;key_active?:boolean;logo_type?:string|null;logo_version?:number}|null}=await ctx.client.from('widget_settings').select('label,color,initials,prompts,controls,public_key,key_active,logo_type,logo_version').eq('bot_id',bot).eq('user_id',ctx.userId).maybeSingle();
 if((settings as {error?:unknown}).error)settings=await ctx.client.from('widget_settings').select('label,color,initials,prompts,controls').eq('user_id',ctx.userId).maybeSingle();
 return NextResponse.json(error?{error:'Could not load requests.'}:{requests:data,cases:cases.data??[],settings:settings.data?{...settings.data,...settings.data.controls}:null,installKey:settings.data?.public_key?{publicKey:settings.data.public_key,active:settings.data.key_active}:null,logoVersion:settings.data?.logo_type?settings.data.logo_version??null:null,bot},{status:error?503:200,headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(Number(req.headers.get('content-length')??0)>6000)return NextResponse.json({error:'Request too large'},{status:413});
 const body=await limitedJson(req,6000).then(v=>v as Record<string,unknown>|null).catch(()=>null);
 try{
  if(body?.action==='feedback'){const d=z.object({token:tokenSchema,id:z.string().uuid(),feedback:z.union([z.literal(1),z.literal(-1)])}).parse(body);const {data,error}=await publicClient().rpc('support_rate_knowledge',{p_hash:hash(d.token),p_id:d.id,p_feedback:d.feedback});if(error||!data)throw Error('Feedback unavailable.');return NextResponse.json({note:'Feedback recorded.'});}
  /* CSAT (db/065): 1 to 5 for the whole conversation; score only. */
  if(body?.action==='rate'){const d=z.object({token:tokenSchema,score:z.number().int().min(1).max(5)}).parse(body);if(!await allowRequest('rate:'+hash(d.token),Date.now(),10))return NextResponse.json({error:'Please wait a minute.'},{status:429});const {data,error}=await publicClient().rpc('support_rate_case',{p_hash:hash(d.token),p_score:d.score});if(error||data!==true)return NextResponse.json({error:'Rating unavailable.'},{status:400});return NextResponse.json({note:'Rating recorded.'});}
  if(body?.action==='open'){
   const d=z.object({token:tokenSchema,source:sourceSchema}).parse(body);
   if(!await allowRequest('open:'+hash(d.token),Date.now(),10))return NextResponse.json({recorded:false},{status:429});
   const r=await publicClient().rpc('support_record_open',{p_hash:hash(d.token),p_source:d.source}).then(x=>!x.error&&x.data===true,()=>false);
   return NextResponse.json({recorded:r},{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='answer'){
   const d=z.object({token:tokenSchema,question:z.string().trim().min(3).max(500),source:sourceSchema}).parse(body);safeKnowledge(d.question);
   // Prompt-injection guard (same check as the widget): refused before the rate limit, budget or any model call.
   if(promptInjection(d.question))return NextResponse.json({error:PROMPT_INJECTION_REFUSAL,code:'prompt_injection'},{status:400,headers:{'Cache-Control':'no-store'}});
   if(!await allowRequest(hash(d.token)))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   // Across conversations from one visitor address: protects the workspace's monthly AI answers from one abuser.
   if(!isInternal(req.headers)&&!await allowRequest('answer-ip:'+clientIp(req.headers),Date.now(),20))return NextResponse.json({error:'Too many questions from your network. Please wait a minute.'},{status:429});
   const capability=await publicClient().rpc('support_case_view',{p_hash:hash(d.token)});if(capability.error||!capability.data)throw Error('Invalid or expired demo link.');const billing=await billingAnswer(d.token,d.question,capability.data);if(billing){const j=await billing.clone().json().catch(()=>null) as {interactionId?:string;answer?:string}|null;await recordAnswer(d.token,j?.interactionId,j?.answer,d.source);return billing;}const reservation=await publicClient().rpc('support_reserve_knowledge',{p_hash:hash(d.token),p_question:d.question});if(reservation.error||!reservation.data)throw Error('Demo question budget reached or unavailable.');if(instructionExtraction(d.question)){const finish=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(d.token),p_id:reservation.data,p_supported:false,p_count:0});if(finish.error||!finish.data)throw Error('Case paused or unavailable. Ask a person to review.');await recordAnswer(d.token,reservation.data,'I can help with questions about the published information, but cannot share private instructions.',d.source);return NextResponse.json({answer:'I can help with questions about the published information, but cannot share private instructions.',supported:false,sources:[],interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});}const custom=await publicClient().rpc('support_custom_response',{p_hash:hash(d.token),p_question:d.question});if(custom.error)throw Error('Custom knowledge unavailable. Ask a person to review.');if(custom.data){const answer=exactCustomAnswer(custom.data);const logged=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(d.token),p_id:reservation.data,p_supported:true,p_count:1});if(logged.error||!logged.data)throw Error('Could not record demo question.');await recordAnswer(d.token,reservation.data,answer.answer,d.source);return NextResponse.json({...answer,interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});}const vector=await embedKnowledge(d.question,true);/* db/066 adds keyword matching beside similarity; a database without it uses the similarity-only form. */let found=await publicClient().rpc('support_knowledge_vectors',{p_hash:hash(d.token),p_embedding:vector,p_question:d.question});if(found.error)found=await publicClient().rpc('support_knowledge_vectors',{p_hash:hash(d.token),p_embedding:vector});const {data,error}=found;if(error)throw Error('Knowledge unavailable. Ask a person to review.');const answer=await answerKnowledge(d.question,data??[],knowledgeDiagnostic,capability.data.modelTier==='deep'?'deep':'fast');const logged=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(d.token),p_id:reservation.data,p_supported:answer.supported,p_count:answer.sources.length});if(logged.error||!logged.data)throw Error('Could not record demo question. Ask a person to review.');await recordAnswer(d.token,reservation.data,answer.answer,d.source);return NextResponse.json({...answer,interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='billing_verify'){
   const d=z.object({token:tokenSchema,provider:z.string().refine(p=>!!enabledDefinition(p)),reference:z.string().trim().min(3).max(80),email:z.string().trim().max(254).email()}).parse(body);
   if(!await allowRequest('billing:'+hash(d.token)))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   try{const r=await verifyVisitor({store:supabaseBillingStore(publicClient())},{caseHash:hash(d.token),provider:d.provider as BillingProviderId,reference:d.reference,email:d.email});
    return NextResponse.json(r.ok?{verified:true,provider:r.provider,mode:r.mode,expiresAt:r.expiresAt}:{error:r.error},{status:r.ok?200:r.status,headers:{'Cache-Control':'no-store'}});
   }catch(e){return NextResponse.json({error:safeErrorMessage(e)},{status:503});}
  }
  if(body?.action==='billing_refund'){
   const d=z.object({token:tokenSchema,lookupId:z.string().uuid(),message:z.string().trim().min(5).max(1000)}).parse(body);
   if(!await allowRequest('billing:'+hash(d.token)))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   try{const r=await requestRefundReview({store:supabaseBillingStore(publicClient())},{caseHash:hash(d.token),lookupId:d.lookupId,message:d.message});
    if(r.ok)alertOwner(d.token,'refund_review');
    return NextResponse.json(r.ok?{id:r.id,note:r.note}:{error:r.error},{status:r.ok?200:400});
   }catch(e){return NextResponse.json({error:safeErrorMessage(e)},{status:503});}
  }
  if(body?.action==='messages'){
   const d=z.object({token:tokenSchema,after:z.string().datetime({offset:true}).nullable().optional()}).parse(body);
   if(!await allowRequest('poll:'+hash(d.token),Date.now(),15))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   const {data,error}=await publicClient().rpc('support_case_messages',{p_hash:hash(d.token),p_after:d.after??null});
   // Fail soft on a database without 045: no thread, nothing breaks.
   if(error)return NextResponse.json({inboxState:null,messages:[]},{headers:{'Cache-Control':'no-store'}});
   if(!data)return NextResponse.json({error:modeText('This fictional demo link is unavailable or expired.','This chat link is unavailable or expired.')},{status:404,headers:{'Cache-Control':'no-store'}});
   return NextResponse.json({inboxState:data.inboxState??null,messages:Array.isArray(data.messages)?data.messages:[]},{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='visitor_message'){
   const d=z.object({token:tokenSchema,body:messageBody}).parse(body);
   if(!await allowRequest('visitor:'+hash(d.token)))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   const {data,error}=await publicClient().rpc('support_visitor_message',{p_hash:hash(d.token),p_body:d.body});
   if(error||!data)throw Error('Message not sent. A person needs to join this chat first, and the demo link must not have expired.');
   return NextResponse.json({id:data,note:'Message sent to the team in this chat. Nothing is emailed.'},{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='request'){
   const d=z.object({token:tokenSchema,kind:z.enum(['refund_request','receipt_request','billing_question','human_handoff','lead_callback']),message:z.string().trim().min(5).max(1000),email:z.string().email().max(254).optional(),consent:z.boolean().default(false)}).parse(body);
   const {data,error}=await publicClient().rpc('support_case_contact',{p_hash:hash(d.token),p_kind:d.kind,p_message:d.message,p_email:d.email??null,p_consent:d.consent});
   if(error)throw Error('Request unavailable, expired or limit reached.');
   if(d.kind==='human_handoff')alertOwner(d.token,'handoff');else if(d.kind==='refund_request')alertOwner(d.token,'refund_review');
   // Signed webhook for this request (if the workspace has one): delivered after the response is sent.
   after(async()=>{const svc=serviceClient();if(svc)await deliverDueWebhooks(svc,{caseHash:hash(d.token),limit:3});});
   if(d.email&&d.consent)alertOwner(d.token,'lead');
   if(d.kind==='human_handoff'){const hours=await handoffHours(d.token);return NextResponse.json({id:data,note:hours.open?'A person has been asked to join this chat. Replies appear here.'+(d.email&&d.consent?' The team may also email a reply to the address you shared.':''):hours.awayMessage+' Your request is saved for the team.',open:hours.open});}
   return NextResponse.json({id:data,note:modeText('Sent to the demo owner for review.','Sent to the team for review.')+' No refund or payment has been made.'+(d.email&&d.consent?' The team can see the address you shared and may reply by email.':'')});
  }
  const ctx=await authenticate(req);if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
  if(!await allowRequest(ctx.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
  if(body?.action==='inbox'){const d=z.object({id:z.string().uuid(),state:z.enum(['open','taken_over','closed'])}).parse(body);const{data,error}=await ctx.client.rpc('set_support_inbox',{p_id:d.id,p_state:d.state});if(error||!data)throw Error('Case unavailable.');return NextResponse.json({note:'Case state updated. No message or payment sent.'});}
  if(body?.action==='settings'){
   const bot=botParam(body.bot,ctx.userId);const current=await ctx.client.from('widget_settings').select('controls').eq('bot_id',bot).eq('user_id',ctx.userId).maybeSingle();if(current.error)throw Error('Could not load current settings.');const settings=widgetSettings.parse({...current.data?.controls,...(body.settings as Record<string,unknown>)});const{label,color,initials,prompts,...controls}=settings;
   const {error}=await ctx.client.from('widget_settings').upsert({user_id:ctx.userId,bot_id:bot,label,color,initials,prompts,controls},{onConflict:'bot_id'});if(error)throw Error('Could not save widget settings.');return NextResponse.json({note:'Widget appearance and quick prompts saved. No external script or image URL accepted.'});
  }
  /* Permanent install key (db/055): create or rotate (server-generated, 24 base62 chars), or turn on/off. */
  if(body?.action==='widget_key'){
   const d=z.object({op:z.enum(['rotate','enable','disable']),mode:z.enum(['live','test']).default('live')}).parse(body);
   if(d.op==='rotate'){const key=newWidgetKey(d.mode);const{error}=await ctx.client.rpc('rotate_widget_key',{p_key:key,p_bot:rpcBot(botParam(body.bot,ctx.userId),ctx.userId)});if(error)throw Error('Could not create the install key. Managers and above can do this.');return NextResponse.json({publicKey:key,keyActive:true,note:'New install key created. The previous key, if any, stopped working; update the script on your site.'});}
   const{data,error}=await ctx.client.rpc('set_widget_key_active',{p_active:d.op==='enable',p_bot:rpcBot(botParam(body.bot,ctx.userId),ctx.userId)});if(error||!data)throw Error('Create an install key first.');
   return NextResponse.json({keyActive:d.op==='enable',note:d.op==='enable'?'Install key turned on. The widget shows again on your allowed sites.':'Install key turned off. The widget stops loading on every site until you turn it on.'});
  }
  if(body?.action==='create_demo'){
   const token=randomBytes(32).toString('hex'),id=randomUUID(),expires=new Date(Date.now()+3600000).toISOString();
   const demoBot=botParam(body.bot,ctx.userId);const {error}=await ctx.client.from('support_cases').insert({id,user_id:ctx.userId,...(demoBot!==ctx.userId?{bot_id:demoBot}:{}),token_hash:hash(token),expires_at:expires,order_label:'Fictional Launch Kit order',amount:19});if(error)throw Error('Could not create demo.');
   return NextResponse.json({token,expiresAt:expires,note:modeText('Fictional case only. This link expires in one hour; anyone with it can submit up to five demo requests.','Test chat created with a sample order. This link expires in one hour; anyone with it can submit up to five requests.')});
  }
  if(body?.action==='review'){
   const id=z.string().uuid().parse(body.id);const {data,error}=await ctx.client.rpc('support_review_request',{p_id:id});if(error||!data)throw Error('Request not pending or unavailable.');return NextResponse.json({note:'Marked reviewed. No payment action taken.'});
  }
  throw Error('Unsupported request.');
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Check the request fields.':e instanceof Error?e.message:'Request failed.'},{status:400});}
}
// Billing questions on a case whose workspace has an enabled provider connected. Returns null to fall
// through to the published-knowledge flow. Billing answers still use the knowledge reservation, so
// takeover, in-flight suppression and the 20/case and 100/day budgets apply unchanged.
async function billingAnswer(token:string,question:string,view:{inboxState?:string}):Promise<NextResponse|null>{
 const intent=billingIntent(question);if(!intent)return null;
 const store=supabaseBillingStore(publicClient());const status=await store.status(hash(token)).catch(()=>null);
 const support=visitorBillingSupport(status);if(!support)return null;
 if(view.inboxState==='taken_over'||view.inboxState==='closed')throw Error('Case paused or unavailable. Ask a person to review.');
 if(!support.verified)return NextResponse.json({answer:VERIFY_REQUIRED,answerKind:'billing_verification_required',supported:false,sources:[]},{headers:{'Cache-Control':'no-store'}});
 const reservation=await publicClient().rpc('support_reserve_knowledge',{p_hash:hash(token),p_question:question});if(reservation.error||!reservation.data)throw Error('Demo question budget reached or unavailable.');
 let result;try{result=await answerBilling({store},{caseHash:hash(token),intent});}catch(e){result={ok:false as const,kind:'error' as const,error:safeErrorMessage(e),status:503};}
 const supported=result.ok&&result.answer.supported,count=result.ok?result.answer.sources.length:0;
 const finish=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(token),p_id:reservation.data,p_supported:supported,p_count:count});if(finish.error||!finish.data)throw Error('Case paused or unavailable. Ask a person to review.');
 if(!result.ok){if(result.kind==='verification_required')return NextResponse.json({answer:VERIFY_REQUIRED,answerKind:'billing_verification_required',supported:false,sources:[],interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});throw Error(result.error);}
 return NextResponse.json({answer:result.answer.answer,supported:result.answer.supported,sources:result.answer.sources,answerKind:'billing_record',billing:{cards:result.answer.cards,lookupId:result.lookupId,mode:result.mode,provider:result.provider},interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});
}
// Working hours for a person handoff, read from the case's widget controls. Missing or invalid settings
// mean open (the pre-045 behaviour: a person can always be asked).
async function handoffHours(token:string):Promise<{open:boolean;awayMessage:string}>{
 const view=await publicClient().rpc('support_case_view',{p_hash:hash(token)}).then(r=>r.data as {controls?:{workingHours?:unknown}}|null,()=>null);
 const parsed=workingHours.safeParse(view?.controls?.workingHours);
 if(!parsed.success)return {open:true,awayMessage:DEFAULT_AWAY_MESSAGE};
 return {open:isOpenNow(parsed.data),awayMessage:parsed.data.awayMessage||DEFAULT_AWAY_MESSAGE};
}
