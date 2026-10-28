import{limitedJson}from'../../../lib/limited-json';
import { NextRequest,NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import {answerKnowledge,safeKnowledge,embedKnowledge,exactCustomAnswer} from '../../../lib/knowledge';
import { z } from 'zod';
import {authenticate} from '../../../lib/session';
import {validOrigin} from '../../../lib/origin';
import {allowRequest} from '../../../lib/rate-limit';
const tokenSchema=z.string().regex(/^[a-f0-9]{64}$/);
const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
function publicClient(){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});}
export async function GET(req:NextRequest){
 const token=req.nextUrl.searchParams.get('token');
 if(token){const parsed=tokenSchema.safeParse(token);if(!parsed.success)return NextResponse.json({error:'Invalid demo link.'},{status:400});
  const {data,error}=await publicClient().rpc('support_case_view',{p_hash:hash(token)});
  return NextResponse.json(error||!data?{error:'This fictional demo link is unavailable or expired.'}:{case:data},{status:error||!data?404:200,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 }
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 const {data,error}=await ctx.client.from('support_requests').select('id,case_id,created_at,kind,message,status,contact_email,contact_consent').eq('user_id',ctx.userId).order('created_at',{ascending:false}).limit(100);
 const settings=await ctx.client.from('widget_settings').select('label,color,initials,prompts').eq('user_id',ctx.userId).maybeSingle();
 return NextResponse.json(error?{error:'Could not load requests.'}:{requests:data,settings:settings.data},{status:error?503:200,headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(Number(req.headers.get('content-length')??0)>6000)return NextResponse.json({error:'Request too large'},{status:413});
 const body=await limitedJson(req,6000).then(v=>v as Record<string,unknown>|null).catch(()=>null);
 try{
  if(body?.action==='feedback'){const d=z.object({token:tokenSchema,id:z.string().uuid(),feedback:z.union([z.literal(1),z.literal(-1)])}).parse(body);const {data,error}=await publicClient().rpc('support_rate_knowledge',{p_hash:hash(d.token),p_id:d.id,p_feedback:d.feedback});if(error||!data)throw Error('Feedback unavailable.');return NextResponse.json({note:'Feedback recorded.'});}
  if(body?.action==='answer'){
   const d=z.object({token:tokenSchema,question:z.string().trim().min(3).max(500)}).parse(body);safeKnowledge(d.question);
   if(!allowRequest(hash(d.token)))return NextResponse.json({error:'Please wait a minute.'},{status:429});
   const capability=await publicClient().rpc('support_case_view',{p_hash:hash(d.token)});if(capability.error||!capability.data)throw Error('Invalid or expired demo link.');const reservation=await publicClient().rpc('support_reserve_knowledge',{p_hash:hash(d.token),p_question:d.question});if(reservation.error||!reservation.data)throw Error('Demo question budget reached or unavailable.');const custom=await publicClient().rpc('support_custom_response',{p_hash:hash(d.token),p_question:d.question});if(custom.error)throw Error('Custom knowledge unavailable. Ask a person to review.');if(custom.data){const answer=exactCustomAnswer(custom.data);const logged=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(d.token),p_id:reservation.data,p_supported:true,p_count:1});if(logged.error||!logged.data)throw Error('Could not record demo question.');return NextResponse.json({...answer,interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});}const vector=await embedKnowledge(d.question,true);const {data,error}=await publicClient().rpc('support_knowledge_vectors',{p_hash:hash(d.token),p_embedding:vector});if(error)throw Error('Knowledge unavailable. Ask a person to review.');const answer=await answerKnowledge(d.question,data??[]);const logged=await publicClient().rpc('support_finish_knowledge',{p_hash:hash(d.token),p_id:reservation.data,p_supported:answer.supported,p_count:answer.sources.length});if(logged.error||!logged.data)throw Error('Could not record demo question. Ask a person to review.');return NextResponse.json({...answer,interactionId:reservation.data},{headers:{'Cache-Control':'no-store'}});
  }
  if(body?.action==='request'){
   const d=z.object({token:tokenSchema,kind:z.enum(['refund_request','receipt_request','billing_question','human_handoff','lead_callback']),message:z.string().trim().min(5).max(1000),email:z.string().email().max(254).optional(),consent:z.boolean().default(false)}).parse(body);
   const {data,error}=await publicClient().rpc('support_case_contact',{p_hash:hash(d.token),p_kind:d.kind,p_message:d.message,p_email:d.email??null,p_consent:d.consent});
   if(error)throw Error('Request unavailable, expired or limit reached.');return NextResponse.json({id:data,note:'Sent to the demo owner for review. No refund, payment or email has been sent.'});
  }
  const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
  if(!allowRequest(ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
  if(body?.action==='settings'){
   const settings=z.object({label:z.string().trim().min(1).max(40),color:z.string().regex(/^#[a-fA-F0-9]{6}$/),initials:z.string().trim().min(1).max(3),prompts:z.array(z.string().trim().min(3).max(100)).max(4)}).parse(body.settings);
   const {error}=await ctx.client.from('widget_settings').upsert({user_id:ctx.userId,...settings});if(error)throw Error('Could not save widget settings.');return NextResponse.json({note:'Widget appearance and quick prompts saved. No external script or image URL accepted.'});
  }
  if(body?.action==='create_demo'){
   const token=randomBytes(32).toString('hex'),id=randomUUID(),expires=new Date(Date.now()+3600000).toISOString();
   const {error}=await ctx.client.from('support_cases').insert({id,user_id:ctx.userId,token_hash:hash(token),expires_at:expires,order_label:'Fictional Launch Kit order',amount:19});if(error)throw Error('Could not create demo.');
   return NextResponse.json({token,expiresAt:expires,note:'Fictional case only. This link expires in one hour; anyone with it can submit up to five demo requests.'});
  }
  if(body?.action==='review'){
   const id=z.string().uuid().parse(body.id);const {data,error}=await ctx.client.rpc('support_review_request',{p_id:id});if(error||!data)throw Error('Request not pending or unavailable.');return NextResponse.json({note:'Marked reviewed. No payment action taken.'});
  }
  throw Error('Unsupported request.');
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Check the request fields.':e instanceof Error?e.message:'Request failed.'},{status:400});}
}
