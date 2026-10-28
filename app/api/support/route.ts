import { NextRequest,NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
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
 const {data,error}=await ctx.client.from('support_requests').select('id,case_id,created_at,kind,message,status').eq('user_id',ctx.userId).order('created_at',{ascending:false}).limit(100);
 return NextResponse.json(error?{error:'Could not load requests.'}:{requests:data},{status:error?503:200,headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(Number(req.headers.get('content-length')??0)>6000)return NextResponse.json({error:'Request too large'},{status:413});
 const body=await req.json().catch(()=>null);
 try{
  if(body?.action==='request'){
   const d=z.object({token:tokenSchema,kind:z.enum(['refund_request','receipt_request','billing_question']),message:z.string().trim().min(5).max(1000)}).parse(body);
   const {data,error}=await publicClient().rpc('support_case_request',{p_hash:hash(d.token),p_kind:d.kind,p_message:d.message});
   if(error)throw Error('Request unavailable, expired or limit reached.');return NextResponse.json({id:data,note:'Sent to the demo owner for review. No refund, payment or email has been sent.'});
  }
  const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
  if(!allowRequest(ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
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
