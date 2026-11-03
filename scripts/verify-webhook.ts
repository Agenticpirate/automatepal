import assert from'node:assert/strict';import{createHmac}from'node:crypto';import{webhookUrl,publicV4,webhookSignature}from'../lib/webhook';
for(const u of ['http://public.example/hook','https://127.0.0.1/hook','https://localhost/hook','https://10.0.0.1','https://good.example:8443/hook','https://user:pass@good.example/hook','https://good.example/hook?token=secret','https://good.internal/hook'])assert.throws(()=>webhookUrl(u));assert.equal(webhookUrl('https://receiver.example/hook').hostname,'receiver.example');for(const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1'])assert.equal(publicV4(ip),false,ip);assert.equal(publicV4('8.8.8.8'),true);const sig=webhookSignature('fictional-key',100,'{"id":"fixture"}');assert.equal(sig,createHmac('sha256','fictional-key').update('100.{"id":"fixture"}').digest('hex'));assert.notEqual(sig,webhookSignature('fictional-key',101,'{"id":"fixture"}'));assert.notEqual(sig,webhookSignature('fictional-key',100,'{"id":"changed"}'));console.log('PASS webhook URL/IP guard and timestamp/raw-body HMAC fixture. No external sends.');
// Cloudflare Workers transport (fetch, no pinned socket): DNS still checked first, signature intact,
// redirects never followed, response size capped. No outside network: resolver and fetch are fakes.
void (async()=>{
 const {deliverWebhook:send,webhookSignature:sig}=await import('../lib/webhook');
 let calls=0,seen:{url:string;init:RequestInit}|null=null;
 const fake=(status:number,body='ok',extra:Record<string,string>={})=>(async(url:string,init:RequestInit)=>{calls++;seen={url,init};return new Response(body,{status,headers:extra});}) as unknown as typeof fetch;
 await assert.rejects(send('https://hooks.example.com/in','s'.repeat(32),{a:1},'evt-1',{transport:'fetch',resolve4:async()=>['10.0.0.2'],fetch:fake(200)}),/not public/);
 await assert.rejects(send('https://hooks.example.com/in','s'.repeat(32),{a:1},'evt-1',{transport:'fetch',resolve4:async()=>['93.184.216.34','127.0.0.1'],fetch:fake(200)}),/not public/);
 assert.equal(calls,0,'private or mixed DNS: no request sent');
 const status=await send('https://hooks.example.com/in','s'.repeat(32),{a:1},'evt-2',{transport:'fetch',resolve4:async()=>['93.184.216.34'],fetch:fake(202)});
 assert.equal(status,202);assert.equal(seen!.init.redirect,'manual');
 const h=seen!.init.headers as Record<string,string>,ts=Number(h['X-AutomatePal-Timestamp']);
 assert.equal(h['X-AutomatePal-Signature'],'v1='+sig('s'.repeat(32),ts,String(seen!.init.body)));assert.equal(h['X-AutomatePal-Event-Id'],'evt-2');
 assert.equal(await send('https://hooks.example.com/in','s'.repeat(32),{a:1},'evt-3',{transport:'fetch',resolve4:async()=>['93.184.216.34'],fetch:fake(302,'',{location:'http://169.254.169.254/'})}),302,'a redirect is reported, not followed');
 await assert.rejects(send('https://hooks.example.com/in','s'.repeat(32),{a:1},'evt-4',{transport:'fetch',resolve4:async()=>['93.184.216.34'],fetch:fake(200,'x'.repeat(5000))}),/too large/);
 console.log('PASS webhook Workers transport: DNS checked first, signed, redirects not followed, response capped');
})().catch(e=>{console.error(e);process.exit(1);});
