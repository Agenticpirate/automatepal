import {limitedJson} from '../../../lib/limited-json';
import { NextRequest,NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../../../lib/session';
import { validOrigin } from '../../../lib/origin';
import { allowRequest } from '../../../lib/rate-limit';
import { proofInput,fetchEvidence,assessEvidence } from '../../../lib/proof';
import { requestContext } from '../../../lib/session';
import { proposeAction } from '../../../lib/actions';
import { PROOF_TOOLS,proofPaymentSchema } from '../../../lib/proof-payments';
import { allEvents } from '../../../lib/store';
import { z } from 'zod';
import {reconcileProof} from '../../../lib/proof-reconciliation';
export async function GET(req:NextRequest){
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 const {data,error}=await ctx.client.from('proof_contracts').select('*').eq('user_id',ctx.userId).order('created_at',{ascending:false}).limit(30);
 if(error)return NextResponse.json({error:'Could not load proof contracts.'},{status:503});
 const ids=(data??[]).map(c=>c.id);const assessments=ids.length?await ctx.client.from('proof_assessments').select('*').eq('user_id',ctx.userId).in('contract_id',ids).order('created_at',{ascending:false}).limit(60):{data:[]};
 const events=await requestContext.run(ctx,()=>allEvents('paypal_sandbox'));
 return NextResponse.json({contracts:data,assessments:assessments.data??[],events:events.filter(e=>e.meta?.contractId)},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!allowRequest(ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 const body=await limitedJson(req,16000).then(v=>v as Record<string,unknown>|null).catch(()=>null);
 try{
  if(body?.action==='reconcile'){const report=await requestContext.run(ctx,()=>reconcileProof(z.string().uuid().parse(body.id)));return NextResponse.json({report},{headers:{'Cache-Control':'no-store'}});}
  if(body&&typeof body.action==='string'&&PROOF_TOOLS.includes(body.action)){
   if(process.env.PROOF_PAYMENTS_ENABLED!=='true')throw Error('Proof payment execution is not enabled yet.');
   if(ctx.email!==process.env.APP_OWNER_EMAIL)throw Error('Only the sandbox owner can prepare PayPal actions.');
   const args=proofPaymentSchema.parse({contractId:body.id,reason:body.reason});
   const pending=await requestContext.run(ctx,()=>proposeAction(String(body.action),args));
   return NextResponse.json({pending});
  }
  if(body?.action==='create'){
   const input=proofInput.parse(body.input);const id=randomUUID();
   const {error}=await ctx.client.from('proof_contracts').insert({id,user_id:ctx.userId,title:input.title,amount:input.amount,pr_url:input.prUrl,criteria:input.criteria,required_checks:input.requiredChecks});
   if(error)throw Error('Could not save contract.');return NextResponse.json({id});
  }
  const id=z.string().uuid().parse(body?.id);if(body?.action!=='assess')throw Error('Unsupported action');
  const {data,error}=await ctx.client.from('proof_contracts').select('*').eq('id',id).eq('user_id',ctx.userId).single();if(error||!data)throw Error('Contract not found');
  const input=proofInput.parse({title:data.title,amount:Number(data.amount),prUrl:data.pr_url,criteria:data.criteria,requiredChecks:data.required_checks});
  const evidence=await fetchEvidence(input.prUrl);const assessment=await assessEvidence(input,evidence);
  const {error:saveError}=await ctx.client.from('proof_assessments').insert({id:randomUUID(),contract_id:id,user_id:ctx.userId,evidence,assessment});if(saveError)throw Error('Could not save assessment.');
  return NextResponse.json({evidence,assessment});
 }catch(e){return NextResponse.json({error:e instanceof z.ZodError?'Check the contract fields.':e instanceof Error?e.message:'Evidence check failed.'},{status:400});}
}
