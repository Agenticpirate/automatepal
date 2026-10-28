import { z } from 'zod';
import {requestContext} from './session';
import {allEvents,addEvent} from './store';
import * as paypal from './paypal';
import {proofInput,fetchEvidence,assessEvidence} from './proof';
export const proofPaymentSchema=z.object({contractId:z.string().uuid(),reason:z.string().trim().min(10).max(500)});
export const PROOF_TOOLS=['proof_create_order','proof_authorize','proof_capture','proof_void'];
type PaymentOrder={id:string;intent:string;status:string;purchase_units:{custom_id?:string;amount?:{value:string;currency_code:string};payments?:{authorizations?:{id:string;status:string}[]}}[];links?:{rel:string;href:string}[]};
async function executeProofPayment(tool:string,raw:Record<string,unknown>){
 if(process.env.PROOF_PAYMENTS_ENABLED!=='true')throw Error('Proof payment execution is disabled pending sandbox acceptance tests. Evidence assessment is available.');
 const args=proofPaymentSchema.parse(raw);const ctx=requestContext.getStore();
 if(!ctx||ctx.email!==process.env.APP_OWNER_EMAIL)throw Error('Only the sandbox owner can execute proof payment actions.');
 const {data:c,error}=await ctx.client.from('proof_contracts').select('*').eq('id',args.contractId).eq('user_id',ctx.userId).single();if(error||!c)throw Error('Contract not found.');
 const input=proofInput.parse({title:c.title,amount:Number(c.amount),prUrl:c.pr_url,criteria:c.criteria,requiredChecks:c.required_checks});
 const events=(await allEvents('paypal_sandbox')).filter(e=>e.meta?.contractId===c.id);
 const created=events.find(e=>e.kind==='proof_order_created');
 if(tool==='proof_create_order'){
  if(created)throw Error('An order already exists for this contract. Do not create a duplicate.');
  const order=await paypal.createOrder({intent:'AUTHORIZE',purchase_units:[{custom_id:c.id,description:`AutomatePal sandbox: ${c.title}`.slice(0,127),amount:{currency_code:'USD',value:input.amount.toFixed(2)}}],payment_source:{paypal:{experience_context:{brand_name:'AutomatePal Sandbox',user_action:'CONTINUE',return_url:(process.env.RENDER_EXTERNAL_URL??process.env.APP_URL??'http://localhost:3000')+'/proof',cancel_url:(process.env.RENDER_EXTERNAL_URL??process.env.APP_URL??'http://localhost:3000')+'/proof'}}}}) as PaymentOrder;
  if(!order.id)throw Error('PayPal returned no order ID.');
  const approval=order.links?.find(l=>l.rel==='payer-action'||l.rel==='approve')?.href;
  await addEvent({kind:'proof_order_created',refId:order.id,amount:input.amount,note:args.reason,meta:{contractId:c.id,approvalUrl:approval,status:order.status}});
  return {orderId:order.id,approvalUrl:approval,status:order.status,note:'Buyer approval is required. No authorization or capture yet. Sandbox only.'};
 }
 if(!created?.refId)throw Error('Create and approve the sandbox order first.');
 const order=await paypal.getOrder(created.refId) as PaymentOrder;
 if(order.intent!=='AUTHORIZE'||order.purchase_units?.length!==1||order.purchase_units[0].custom_id!==c.id||order.purchase_units[0].amount?.currency_code!=='USD'||Number(order.purchase_units[0].amount?.value)!==input.amount)throw Error('PayPal order does not match the saved agreement.');
 if(tool==='proof_authorize'){
  if(events.some(e=>e.kind==='proof_authorized'))throw Error('Authorization already recorded.');
  if(order.status!=='APPROVED')throw Error('Buyer must approve the order before authorization.');
  const result=await paypal.authorizeOrder(order.id) as PaymentOrder;const a=result.purchase_units?.[0]?.payments?.authorizations?.[0];
  if(!a?.id||a.status!=='CREATED')throw Error('Authorization not confirmed. Check PayPal before retrying.');
  await addEvent({kind:'proof_authorized',refId:a.id,amount:input.amount,note:args.reason,meta:{contractId:c.id,orderId:order.id,status:a.status}});
  return {authorizationId:a.id,status:a.status,note:'Sandbox authorization hold, not legal escrow. Capture is not guaranteed; authorization may expire.'};
 }
 const a=events.find(e=>e.kind==='proof_authorized');if(!a?.refId)throw Error('No recorded authorization.');
 if(events.some(e=>e.kind==='proof_captured'||e.kind==='proof_voided'))throw Error('This contract already has a final payment outcome.');
 const authorization=await paypal.getAuthorization(a.refId) as {id:string;status:string;amount:{value:string;currency_code:string};expiration_time?:string};
 if(authorization.status!=='CREATED'||authorization.amount?.currency_code!=='USD'||Number(authorization.amount?.value)!==input.amount)throw Error('Authorization state or amount is not eligible.');
 if(authorization.expiration_time&&Date.parse(authorization.expiration_time)<=Date.now())throw Error('Authorization expired.');
 if(tool==='proof_void'){
  await paypal.voidAuthorization(a.refId);const verified=await paypal.getAuthorization(a.refId) as {status:string};if(verified.status!=='VOIDED')throw Error('Void not verified. Check PayPal.');
  await addEvent({kind:'proof_voided',refId:a.refId,amount:input.amount,note:args.reason,meta:{contractId:c.id,orderId:order.id,status:'VOIDED'}});
  return {status:'VOIDED',reason:args.reason};
 }
 if(tool!=='proof_capture')throw Error('Unsupported proof action');
 // Never let a stored/forged assessment or stale check result release funds.
 const evidence=await fetchEvidence(input.prUrl);const assessment=await assessEvidence(input,evidence);
 const {error:saveError}=await ctx.client.from('proof_assessments').insert({id:crypto.randomUUID(),contract_id:c.id,user_id:ctx.userId,evidence,assessment});if(saveError)throw Error('Could not save fresh evidence; capture blocked.');
 if(assessment.recommendation!=='review_for_capture')throw Error('Fresh evidence does not support capture. Hold for review.');
 const result=await paypal.captureAuthorization(a.refId,{amount:{currency_code:'USD',value:input.amount.toFixed(2)},final_capture:true}) as {id:string;status:string;amount?:{value:string;currency_code:string}};
 if(result.status!=='COMPLETED'||!result.id)throw Error('Capture not completed. Check PayPal before retrying.');
 await addEvent({kind:'proof_captured',refId:result.id,amount:input.amount,note:args.reason,meta:{contractId:c.id,orderId:order.id,authorizationId:a.refId,status:result.status,headSha:evidence.headSha}});
 return {captureId:result.id,status:result.status,reason:args.reason,headSha:evidence.headSha};
}

export async function proofPayment(tool:string,raw:Record<string,unknown>){
 if(process.env.PROOF_PAYMENTS_ENABLED!=='true')throw Error('Proof payment execution is disabled pending sandbox acceptance tests. Evidence assessment is available.');
 const ctx=requestContext.getStore();const args=proofPaymentSchema.parse(raw);
 if(!ctx?.actionId||ctx.email!==process.env.APP_OWNER_EMAIL||!PROOF_TOOLS.includes(tool))throw Error('Reviewed owner action required.');
 const {data,error}=await ctx.client.rpc('proof_claim_operation',{p_contract:args.contractId,p_action:ctx.actionId});
 if(error||!data)throw Error('This contract is busy or requires reconciliation of an earlier attempt. Do not retry payment actions.');
 try{
  const result=await executeProofPayment(tool,raw);
  const finished=await ctx.client.rpc('proof_finish_operation',{p_contract:args.contractId,p_action:ctx.actionId});
  if(finished.error||!finished.data)throw Error('Outcome recorded but lock cleanup could not be verified. Reconciliation required.');
  return result;
 }catch{
  // Do not release an uncertain operation. PayPal may have succeeded before storage failed.
  throw Error('Proof operation did not finish cleanly. This contract is locked for reconciliation. Check PayPal and saved activity before any further payment action.');
 }
}
