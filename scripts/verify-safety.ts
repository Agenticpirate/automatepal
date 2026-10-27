import assert from 'node:assert/strict';
import { runTool } from '../lib/agent';
import { requestContext } from '../lib/session';
import { proposeAction } from '../lib/actions';
import type { SupabaseClient } from '@supabase/supabase-js';
async function main(){
 await assert.rejects(()=>runTool('create_checkout_order',{amount:-1}));
 await assert.rejects(()=>runTool('create_checkout_order',{amount:1,currency:'EUR'}));
 await assert.rejects(()=>runTool('create_invoice_draft',{customer_email:'real@example.com'}));
 await assert.rejects(()=>runTool('simulate_subscriber_activity',{subscribers:51,monthly_price:12}));
 let inserted:Record<string,unknown>|null=null;
 const client={from:(table:string)=>({insert:async(row:Record<string,unknown>)=>{assert.equal(table,'action_proposals');inserted=row;return {error:null};}})} as unknown as SupabaseClient;
 await requestContext.run({userId:'test-user',email:'visitor@example.invalid',client},async()=>{
  const denied=await runTool('list_products_and_plans',{}) as {error:string};assert.match(denied.error,/Only the owner/);
  const proposal=await proposeAction('create_checkout_order',{amount:19,currency:'USD'});
  assert.equal(proposal.status,'pending');assert.equal(inserted?.user_id,'test-user');assert.equal(inserted?.status,'pending');assert.deepEqual(inserted?.args,{amount:19,currency:'USD'});
 });
 console.log('PASS: invalid amounts/currencies, invoice denial, seed bounds, visitor sandbox isolation, persisted exact pending action');
}
main().catch(e=>{console.error(e);process.exitCode=1});
