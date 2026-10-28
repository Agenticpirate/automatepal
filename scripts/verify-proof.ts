import assert from 'node:assert/strict';
import { proofInput,deterministicGate,fetchEvidence } from '../lib/proof';
import type {GitEvidence} from '../lib/proof';
async function main(){
const input=proofInput.parse({title:'Test deliverable',amount:12,prUrl:'https://github.com/Agenticpirate/automatepal/pull/1',criteria:'The feature is implemented and tested.',requiredChecks:['build']});
const e:GitEvidence={url:input.prUrl,fetchedAt:new Date().toISOString(),title:'Example',body:'',merged:true,draft:false,headSha:'a'.repeat(40),mergeSha:'b'.repeat(40),baseRepo:'Agenticpirate/automatepal',checks:[{name:'build',status:'completed',conclusion:'success',sha:'a'.repeat(40),url:'https://github.com/Agenticpirate/automatepal'}],files:[],checksTruncated:false,filesTruncated:false};
assert.equal(deterministicGate(input,e).eligible,true);
for(const variant of [{merged:false},{draft:true},{checks:[]},{checks:[{...e.checks[0],conclusion:'failure'}]},{checks:[{...e.checks[0],sha:'c'.repeat(40)}]},{checksTruncated:true},{filesTruncated:true},{checks:[...e.checks,...e.checks]}])assert.equal(deterministicGate(input,{...e,...variant}).eligible,false);
assert.equal(proofInput.safeParse({...input,prUrl:'http://127.0.0.1/private'}).success,false);
assert.equal(proofInput.safeParse({...input,prUrl:'https://github.com.evil.invalid/a/b/pull/1'}).success,false);
assert.equal(proofInput.safeParse({...input,amount:1.001}).success,false);
assert.equal(proofInput.safeParse({...input,requiredChecks:[]}).success,false);
await assert.rejects(()=>fetchEvidence('http://169.254.169.254/latest/meta-data'));
console.log('PASS Proof gates: merged, draft, required checks, exact SHA, truncation, ambiguity, money precision, SSRF denial');

}
main().catch(e=>{console.error(e);process.exitCode=1});
