import assert from 'node:assert/strict';
import {proofPayment} from '../lib/proof-payments';
import {requestContext} from '../lib/session';
import type{SupabaseClient}from'@supabase/supabase-js';
async function main(){const original=process.env.PROOF_PAYMENTS_ENABLED;const owner=process.env.APP_OWNER_EMAIL;try{
 delete process.env.PROOF_PAYMENTS_ENABLED;await assert.rejects(()=>proofPayment('proof_capture',{}),/disabled/);
 process.env.PROOF_PAYMENTS_ENABLED='true';process.env.APP_OWNER_EMAIL='owner@example.invalid';let claims=0;
 const client={rpc:async(name:string)=>{assert.equal(name,'proof_claim_operation');claims++;return{data:false,error:null};}} as unknown as SupabaseClient;
 const args={contractId:'ae991e0e-f4bb-4e09-9983-30b2c0e46bf9',reason:'Test guard only, no provider call'};
 await requestContext.run({userId:'fixture',email:'visitor@example.invalid',client,actionId:'fixture'},async()=>{await assert.rejects(()=>proofPayment('proof_capture',args),/owner action/);});assert.equal(claims,0);
 await requestContext.run({userId:'fixture',email:'owner@example.invalid',client},async()=>{await assert.rejects(()=>proofPayment('proof_capture',args),/owner action/);});assert.equal(claims,0);
 await requestContext.run({userId:'fixture',email:'owner@example.invalid',client,actionId:'fixture'},async()=>{await assert.rejects(()=>proofPayment('proof_capture',args),/reconciliation/);});assert.equal(claims,1);
 console.log('PASS proof payment guards: disabled by default, visitor denied, missing reviewed action denied, unavailable contract lock prevents provider access.');
}finally{if(original===undefined)delete process.env.PROOF_PAYMENTS_ENABLED;else process.env.PROOF_PAYMENTS_ENABLED=original;if(owner===undefined)delete process.env.APP_OWNER_EMAIL;else process.env.APP_OWNER_EMAIL=owner;}}
main().catch(e=>{console.error(e);process.exitCode=1});
