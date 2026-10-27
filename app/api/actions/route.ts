import { NextRequest,NextResponse } from 'next/server';
import { authenticate,requestContext } from '../../../lib/session';
import { runTool } from '../../../lib/agent';
import { z } from 'zod';
const schema=z.object({id:z.string().uuid(),decision:z.enum(['confirm','cancel'])});
export async function GET(req:NextRequest) {
 const ctx=await authenticate(req); if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 const {data,error}=await ctx.client.from('action_proposals').select('id,tool,args,status,created_at').eq('user_id',ctx.userId).eq('status','pending').order('created_at',{ascending:false}).limit(20);
 return NextResponse.json(error?{error:'Could not load pending actions.'}:{actions:data},{status:error?503:200,headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest) {
 const ctx=await authenticate(req); if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 const origin=req.headers.get('origin');if(origin&&origin!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403});
 const parsed=schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:'Invalid action.'},{status:400});
 const {id,decision}=parsed.data;
 // Compare-and-set prevents double clicks and concurrent requests executing twice.
 const {data,error}=await ctx.client.from('action_proposals').update({status:decision==='cancel'?'cancelled':'executing'}).eq('id',id).eq('user_id',ctx.userId).eq('status','pending').select('id,tool,args').maybeSingle();
 if(error)return NextResponse.json({error:'Could not lock action.'},{status:503});
 if(!data)return NextResponse.json({error:'This action is no longer pending. Check activity before retrying.'},{status:409});
 if(decision==='cancel')return NextResponse.json({reply:'Action cancelled.'});
 try {
  const result=await requestContext.run({...ctx,actionId:id},()=>runTool(data.tool,data.args));
  await ctx.client.from('action_proposals').update({status:'completed'}).eq('id',id).eq('user_id',ctx.userId);
  return NextResponse.json({reply:'Action finished. The API response is below.',result});
 } catch {
  await ctx.client.from('action_proposals').update({status:'needs_review'}).eq('id',id).eq('user_id',ctx.userId);
  return NextResponse.json({error:'Action could not be confirmed. Do not repeat it until you check activity; the provider may have accepted it.'},{status:503});
 }
}
