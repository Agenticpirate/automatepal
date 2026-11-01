// Offline checks for lib/llm.ts: no network, no model calls, no spend.
import assert from'node:assert/strict';
import{extractJson,priceUsd,generateJson,llmProvider,llmModel,LlmError,MAX_INPUT_CHARS,resetLlmLedger}from'../lib/llm';
function ok(n:string){console.log('PASS',n);}
async function main(){
 assert.equal(extractJson('{"a":1}'),'{"a":1}');
 assert.equal(extractJson('```json\n{"a":1}\n```'),'{"a":1}');
 assert.equal(extractJson('Here you go: {"a":{"b":2}} thanks'),'{"a":{"b":2}}');
 ok('extractJson: plain, fenced and wrapped JSON');

 assert.equal(priceUsd('claude-haiku-5-5',1_000_000,0),0.10);
 assert.equal(priceUsd('claude-haiku-5-5',0,1_000_000),0.50);
 assert.ok(priceUsd('some-unknown-claude',1_000_000,0)>=2,'unknown models priced conservatively');
 assert.equal(priceUsd('gemini-3.1-flash-lite',1_000_000,1_000_000),0);
 ok('priceUsd: Haiku 5.5 list price, unknown models priced high');

 const saved={...process.env};
 process.env.ANTHROPIC_API_KEY='sk-ant-test';delete process.env.LLM_PROVIDER;
 assert.equal(llmProvider(),'anthropic');assert.equal(llmModel(),process.env.ANTHROPIC_MODEL||'claude-haiku-5-5');
 process.env.LLM_PROVIDER='gemini';assert.equal(llmProvider(),'gemini');
 delete process.env.LLM_PROVIDER;delete process.env.ANTHROPIC_API_KEY;assert.equal(llmProvider(),'gemini');
 ok('provider: Claude when keyed, override with LLM_PROVIDER, Gemini otherwise');

 // Guards refuse before any network call.
 process.env.ANTHROPIC_API_KEY='sk-ant-test';process.env.LLM_DAILY_USD_CAP='0';resetLlmLedger();
 await assert.rejects(generateJson({purpose:'t',system:'s',user:'u',maxTokens:10}),(e:unknown)=>e instanceof LlmError&&e.status===429);
 process.env.LLM_DAILY_USD_CAP='1';
 await assert.rejects(generateJson({purpose:'t',system:'s',user:'x'.repeat(MAX_INPUT_CHARS+1),maxTokens:10}),(e:unknown)=>e instanceof LlmError&&e.status===413);
 await assert.rejects(generateJson({purpose:'t',system:'s',user:'u',maxTokens:5000}),(e:unknown)=>e instanceof LlmError&&e.status===400);
 delete process.env.ANTHROPIC_API_KEY;process.env.LLM_PROVIDER='anthropic';
 await assert.rejects(generateJson({purpose:'t',system:'s',user:'u',maxTokens:10}),(e:unknown)=>e instanceof LlmError&&e.status===500);
 ok('guards: daily ceiling, prompt size, output cap and missing key refuse before any request');
 process.env={...saved};
 console.log('all llm checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
