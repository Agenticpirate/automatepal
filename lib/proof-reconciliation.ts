import {requestContext} from './session';
import {allEvents} from './store';
import * as paypal from './paypal';
import {z} from 'zod';
// Read-only. This report never unlocks or retries an uncertain payment operation.
export async function reconcileProof(rawId:string){
 const id=z.string().uuid().parse(rawId),ctx=requestContext.getStore();
 if(!ctx||!process.env.APP_OWNER_EMAIL||ctx.email!==process.env.APP_OWNER_EMAIL)throw Error('Only the sandbox owner can inspect PayPal reconciliation.');
 const contract=await ctx.client.from('proof_contracts').select('id,title,amount,currency').eq('id',id).eq('user_id',ctx.userId).single();
 if(contract.error||!contract.data)throw Error('Contract not found.');
 const lock=await ctx.client.from('proof_operation_locks').select('action_id,created_at').eq('contract_id',id).eq('user_id',ctx.userId).maybeSingle();
 if(lock.error)throw Error('Operation lock state is unavailable.');
 const events=(await allEvents('paypal_sandbox')).filter(e=>e.meta?.contractId===id);
 const created=events.find(e=>e.kind==='proof_order_created'),authorized=events.find(e=>e.kind==='proof_authorized');
 const [order,authorization]=await Promise.all([created?.refId?paypal.getOrder(created.refId):Promise.resolve(null),authorized?.refId?paypal.getAuthorization(authorized.refId):Promise.resolve(null)]);
 return {checkedAt:new Date().toISOString(),contract:contract.data,lock:lock.data,recordedEvents:events,provider:{order,authorization},notice:'Read-only sandbox reconciliation. A missing recorded ID does not prove PayPal did nothing. A request may have succeeded before storage failed. This report cannot search for unknown order IDs or clear locks. Compare the exact reviewed proposal, PayPal dashboard and saved activity before any manual recovery. Never repeat an uncertain payment action.'};
}
