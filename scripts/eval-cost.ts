// Runs a model eval script and reports real token usage and cost from lib/llm.ts.
// Usage: npx tsx scripts/eval-cost.ts scripts/eval-knowledge.ts
import path from'node:path';
import{onLlmUsage,llmLedger,llmProvider,llmModel,type LlmUsage}from'../lib/llm';
const target=process.argv[2];
if(!target){console.error('usage: eval-cost.ts <eval script>');process.exit(2);}
const calls:LlmUsage[]=[];
onLlmUsage(u=>calls.push(u));
process.on('beforeExit',()=>{
 if((globalThis as {__costPrinted?:boolean}).__costPrinted)return;(globalThis as {__costPrinted?:boolean}).__costPrinted=true;
 const l=llmLedger();
 const by:Record<string,{n:number;in:number;out:number;usd:number}>={};
 for(const c of calls){const b=by[c.purpose]??={n:0,in:0,out:0,usd:0};b.n++;b.in+=c.inputTokens;b.out+=c.outputTokens;b.usd+=c.usd;}
 console.log(`\nCOST ${llmProvider()}/${llmModel()}: ${l.calls} calls, ${l.inputTokens} input + ${l.outputTokens} output tokens, $${l.usd.toFixed(5)} (ceiling $${l.capUsd})`);
 for(const[k,b]of Object.entries(by))console.log(`  ${k.padEnd(10)} ${b.n} calls, ${b.in} in / ${b.out} out, $${b.usd.toFixed(5)}`);
});
import(path.resolve(target));
