import assert from'node:assert/strict';
import{withTransientRetry,isTransient}from'../lib/gemini-retry';
import{answerKnowledge}from'../lib/knowledge';
async function main(){
// transient classification
assert.equal(isTransient(Object.assign(new Error('server error'),{status:500})),true);
assert.equal(isTransient(Object.assign(new Error('quota'),{status:429})),false);
assert.equal(isTransient(Object.assign(new Error('bad request'),{status:400})),false);
assert.equal(isTransient(new Error('fetch failed')),true);
assert.equal(isTransient(new Error('429 quota exceeded')),false);
// retry behavior: at most one extra attempt, only for transient
let calls=0;
const r=await withTransientRetry(async()=>{calls++;if(calls===1)throw Object.assign(new Error('boom'),{status:503});return 'ok';},1);
assert.equal(r,'ok');assert.equal(calls,2);
calls=0;
await assert.rejects(withTransientRetry(async()=>{calls++;throw Object.assign(new Error('quota'),{status:429});},1));
assert.equal(calls,1);
calls=0;
await assert.rejects(withTransientRetry(async()=>{calls++;throw Object.assign(new Error('down'),{status:500});},1));
assert.equal(calls,2);
// provider failure gives honest outage text, not a fake knowledge gap (no API key locally)
delete process.env.GEMINI_API_KEY;
const stages:string[]=[];
const res=await answerKnowledge('Within how many days can I request review?',[{id:'fixture-refund',title:'Fictional refund FAQ',excerpt:'For fictional Launch Kit orders, customers can ask for owner review within 14 days. No automatic refund is promised.'}],s=>stages.push(s));
assert.equal(res.supported,false);
assert.match(res.answer,/temporarily unavailable/);
assert.ok(!/enough published information/.test(res.answer));
assert.ok(stages.some(s=>s==='answer_provider_failed'),'stages: '+stages.join(','));
console.log('PASS gemini transient retry and honest provider-outage fallback; stages:',stages.join(','));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
