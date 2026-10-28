import assert from 'node:assert/strict';
import {fetchEvidence} from '../lib/proof';
async function main(){
const original=globalThis.fetch;let calls=0,conditional=0,changed=false,fail=false;const sha='a'.repeat(40);
const pr={head:{sha},base:{repo:{full_name:'fixture/repo',private:false}},merged:true,draft:false,merge_commit_sha:'b'.repeat(40),html_url:'https://github.com/fixture/repo/pull/1',title:'Fictional reader test',body:'Fixture',changed_files:1};
const representations=new Map<string,unknown>();
globalThis.fetch=async(input,init)=>{calls++;const path=String(input);assert(path.startsWith('https://api.github.com/repos/fixture/repo/'));assert.equal(init?.redirect,'error');if(fail)return new Response(JSON.stringify({message:'Unavailable'}),{status:503});const headers=init?.headers as Record<string,string>;
 if(changed&&path.endsWith('/pulls/1')&&calls%4===0)return Response.json({...pr,head:{sha:'c'.repeat(40)}});
 if(headers['If-None-Match']){conditional++;return new Response(null,{status:304});}
 const data=path.includes('check-runs')?{total_count:1,check_runs:[{name:'test',head_sha:sha,status:'completed',conclusion:'success',html_url:'https://github.com/fixture/repo/actions'}]}:path.includes('/files?')?[{filename:'test.ts',status:'modified',additions:1,deletions:0,patch:'@@ fixture @@'}]:pr;representations.set(path,data);return Response.json(data,{headers:{etag:'"fixture"'}});
};
try{
 const a=await fetchEvidence(pr.html_url);assert.equal(a.headSha,sha);assert.equal(a.filesTruncated,false);const b=await fetchEvidence(pr.html_url);assert.equal(b.checks[0].sha,sha);assert(conditional>=4);assert.equal(representations.size,3);
 fail=true;await assert.rejects(()=>fetchEvidence(pr.html_url),/unavailable/);fail=false;changed=true;calls=0;await assert.rejects(()=>fetchEvidence(pr.html_url),/changed/);
 console.log('PASS public reader: fixed API host, bounded representations, ETag304 revalidation, no stale fallback on error, changed PR held.');
}finally{globalThis.fetch=original;}

}
main().catch(e=>{console.error(e);process.exitCode=1;});
