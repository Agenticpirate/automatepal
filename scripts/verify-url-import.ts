import assert from'node:assert/strict';
import{robotsAllowed,htmlToText,pageTitle,importUrlProblem,resolvedAddrsProblem,safeGet,ImportFetchError,type Addr}from'../lib/url-import';
import{createServer}from'node:http';
function ok(n:string){console.log('PASS',n);}
// robots
assert.equal(robotsAllowed('User-agent: *\nDisallow: /private','/private/page'),false);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /private','/public/page'),true);
assert.equal(robotsAllowed('User-agent: *\nDisallow: /p\nAllow: /public','/public'),true);
assert.equal(robotsAllowed('User-agent: googlebot\nDisallow: /','/anything'),true);
assert.equal(robotsAllowed('User-agent: *\nDisallow:','/anything'),true);
assert.equal(robotsAllowed('','/anything'),true);
assert.equal(robotsAllowed('User-agent: automatepal\nDisallow: /faq','/faq'),false);
ok('robots.txt: disallow, allow precedence, agent scoping, empty rules');
// html to text
const{txtHtml}= {txtHtml:'<html><head><title> FAQ &amp; Help </title><style>body{color:red}</style></head><body><script>alert(1)</script><h1>Returns</h1><p>Send it back within 14 days.</p><br><p>No questions asked &lt;guaranteed&gt;.</p></body></html>'};
const r=htmlToText(txtHtml);
assert.ok(!r.text.includes('alert')&&!r.text.includes('color:red'),'scripts/styles stripped');
assert.ok(r.text.includes('Returns')&&r.text.includes('Send it back within 14 days.'));
assert.ok(r.text.includes('No questions asked <guaranteed>.'));
assert.equal(r.truncated,false);
const big=htmlToText('<p>'+'x'.repeat(40000)+'</p>');
assert.equal(big.truncated,true);
assert.equal([...big.text].length,30000);
assert.equal(pageTitle(txtHtml),'FAQ & Help');
assert.equal(pageTitle('<p>no title</p>'),'');
ok('htmlToText: strips scripts/styles, decodes entities, caps at 30000 chars, title extraction');
// URL validation
assert.equal(importUrlProblem('not a url'),'Enter a full https:// URL.');
assert.equal(importUrlProblem('ftp://example.com/x'),'Only http and https URLs can be imported.');
assert.equal(importUrlProblem('https://user:pass@example.com/x'),'URLs with credentials cannot be imported.');
assert.equal(importUrlProblem('http://192.168.1.5/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('http://localhost:3000/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('https://app.internal/x'),'Private or local addresses cannot be imported.');
assert.equal(importUrlProblem('https://example.com/faq'),null);
ok('URL validation: scheme, credentials, private hosts refused');
// DNS results
assert.equal(resolvedAddrsProblem([]),'That address did not resolve.');
assert.equal(resolvedAddrsProblem([{address:'10.0.0.4',family:4}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'fd00::1',family:6}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'93.184.216.34',family:4},{address:'192.168.0.1',family:4}]),'That address resolves to a private network and cannot be imported.');
assert.equal(resolvedAddrsProblem([{address:'93.184.216.34',family:4}]),null);
ok('DNS validation: any private answer refuses, public passes');
console.log('all url-import checks passed');

// safeGet: SSRF protection on every hop, against a local HTTP server. Hostnames are mapped by a fake resolver:
// 127.0.0.1 stands in for a public address, 10.x answers are private. No outside network is used.
async function safeGetChecks(){
const LOCAL='127.0.0.1';
const hits:string[]=[];
const server=createServer((req,res)=>{
 hits.push(req.url??'');
 const path=req.url??'/';
 if(path==='/page'){res.writeHead(200,{'content-type':'text/html'});res.end('<title>Ok</title><p>Public page text here.</p>');return;}
 if(path==='/to-private'){res.writeHead(302,{location:'http://private.test/secret'});res.end();return;}
 if(path==='/to-metadata'){res.writeHead(301,{location:'http://169.254.169.254/latest/meta-data/'});res.end();return;}
 if(path==='/to-relative'){res.writeHead(302,{location:'/page'});res.end();return;}
 if(path==='/loop'){res.writeHead(302,{location:'/loop'});res.end();return;}
 if(path==='/no-location'){res.writeHead(302);res.end();return;}
 if(path==='/big'){res.writeHead(200,{'content-type':'text/html'});res.end('<p>'+'y'.repeat(5000)+'</p>');return;}
 if(path==='/slow'){setTimeout(()=>{res.writeHead(200,{'content-type':'text/html'});res.end('<p>late</p>');},2000);return;}
 res.writeHead(404);res.end();
});
await new Promise<void>(r=>server.listen(0,LOCAL,r));
const port=(server.address() as {port:number}).port;
const base=(host:string)=>`http://${host}:${port}`;
let lookups:string[]=[];
let rebindCalls=0;
const resolve=async(host:string):Promise<Addr[]>=>{
 lookups.push(host);
 if(host==='public.test')return[{address:LOCAL,family:4}];
 if(host==='private.test')return[{address:'10.0.0.5',family:4}];
 if(host==='mixed.test')return[{address:LOCAL,family:4},{address:'10.0.0.6',family:4}];
 // First answer public, every later answer private: a rebinding attempt.
 if(host==='rebind.test')return rebindCalls++===0?[{address:LOCAL,family:4}]:[{address:'10.0.0.9',family:4}];
 throw new Error('NXDOMAIN');
};
const addrProblem=(a:Addr[])=>a.length&&a.every(x=>x.address===LOCAL)?null:resolvedAddrsProblem(a.filter(x=>x.address!==LOCAL).length?a.filter(x=>x.address!==LOCAL):a);
const opts={resolve,addrProblem};
async function refused(url:string,re:RegExp,extra={}){
 try{await safeGet(url,{...opts,...extra});}catch(e){assert.ok(e instanceof ImportFetchError,'typed error');assert.match((e as Error).message,re);return;}
 assert.fail('expected refusal for '+url);
}
try{
 const okR=await safeGet(base('public.test')+'/page',opts);
 assert.equal(okR.status,200);assert.ok(okR.body.includes('Public page text here.'));assert.match(okR.contentType,/text\/html/);
 ok('safeGet: fetches a public page through the checked address');

 hits.length=0;
 await refused(base('public.test')+'/to-private',/redirected to a private network address/);
 assert.deepEqual(hits,['/to-private'],'the private target was never requested');
 await refused(base('public.test')+'/to-metadata',/redirected to an address that cannot be imported/);
 ok('safeGet: redirects to a private host and to the cloud metadata IP are refused, not followed');

 const rel=await safeGet(base('public.test')+'/to-relative',opts);
 assert.equal(rel.status,200);assert.ok(rel.finalUrl.endsWith('/page'));
 ok('safeGet: a relative redirect to a public page is followed and re-checked');

 await refused(base('public.test')+'/loop',/redirected too many times/);
 await refused(base('public.test')+'/no-location',/without a redirect address/);
 ok('safeGet: redirect loops and empty redirects stop');

 await refused(base('mixed.test')+'/page',/private network/);
 ok('safeGet: a name with any private answer is refused');

 lookups=[];rebindCalls=0;
 const rb=await safeGet(base('rebind.test')+'/page',opts);
 assert.equal(rb.status,200);
 assert.deepEqual(lookups,['rebind.test'],'resolved exactly once; the socket made no second lookup');
 ok('safeGet: DNS rebinding blocked, connection pinned to the address that passed the check');

 const big=await safeGet(base('public.test')+'/big',{...opts,maxBytes:1000});
 assert.equal(big.truncated,true);assert.equal(big.bytes,1000);
 ok('safeGet: body capped at maxBytes');

 await refused(base('public.test')+'/slow',/within 10 seconds/,{deadline:Date.now()+300});
 ok('safeGet: deadline enforced across the whole fetch');

 await refused(base('nowhere.test')+'/page',/did not resolve/);
 await refused('http://localhost:'+port+'/page',/Private or local/);
 ok('safeGet: unresolvable and local hosts refused before any request');

 // Cloudflare Workers transport (fetch, no pinned socket). fetch() resolves names itself, so the literal
 // 127.0.0.1 stands in for a public host here; every other host still goes through the real checks.
 const pub=`http://${LOCAL}:${port}`;
 const fopts={transport:'fetch' as const,resolve,addrProblem,urlProblem:(raw:string)=>new URL(raw).hostname===LOCAL?null:importUrlProblem(raw)};
 const resolveLocal=async(h:string):Promise<Addr[]>=>h===LOCAL?[{address:LOCAL,family:4}]:resolve(h);
 const fo={...fopts,resolve:resolveLocal};
 const fOk=await safeGet(pub+'/page',fo);
 assert.equal(fOk.status,200);assert.ok(fOk.body.includes('Public page text here.'));assert.match(fOk.contentType,/text\/html/);
 ok('safeGet (Workers fetch): fetches a public page');
 hits.length=0;
 await refused(pub+'/to-private',/redirected to a private network address/,fo);
 assert.deepEqual(hits,['/to-private'],'fetch path: the private target was never requested');
 await refused(pub+'/to-metadata',/redirected to an address that cannot be imported/,fo);
 ok('safeGet (Workers fetch): redirects to a private host and the metadata IP are refused, not followed');
 const fRel=await safeGet(pub+'/to-relative',fo);
 assert.equal(fRel.status,200);assert.ok(fRel.finalUrl.endsWith('/page'));
 await refused(pub+'/loop',/redirected too many times/,fo);
 await refused(pub+'/no-location',/without a redirect address/,fo);
 ok('safeGet (Workers fetch): relative redirects re-checked; loops and empty redirects stop');
 const fBig=await safeGet(pub+'/big',{...fo,maxBytes:1000});
 assert.equal(fBig.truncated,true);assert.equal(fBig.bytes,1000);
 await refused(pub+'/slow',/within 10 seconds/,{...fo,deadline:Date.now()+300});
 ok('safeGet (Workers fetch): body cap and deadline enforced');
 await refused(base('mixed.test')+'/page',/private network/,fo);
 await refused('http://localhost:'+port+'/page',/Private or local/,fo);
 ok('safeGet (Workers fetch): private answers and local hosts refused before any request');
}finally{server.close();}
console.log('all safeGet checks passed');
}
safeGetChecks().catch(e=>{console.error(e);process.exit(1);});
