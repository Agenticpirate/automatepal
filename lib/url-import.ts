// Public-URL import helpers. Server-only. Node: pinned node:http/https requests. Cloudflare Workers: fetch() with
// per-hop checks (see fetchRequest). The pure checks are unit-tested without network.
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {privateHost,privateIpV4,privateIpV6} from './install-check';

export function robotsAllowed(robots:string,path:string):boolean{
 // Minimal robots.txt: honors Disallow lines in User-agent: * and User-agent: automatepal groups. Longest-match prefix wins; allow beats disallow at equal length.
 const groups=robots.split(/\n\s*\n/).map(g=>g.split('\n').map(l=>l.trim()));
 let best:{len:number;allow:boolean}|null=null;
 for(const lines of groups){
  const agents=lines.filter(l=>/^user-agent:/i.test(l)).map(l=>l.slice(12).trim().toLowerCase());
  if(!agents.length||!agents.some(a=>a==='*'||a==='automatepal'))continue;
  for(const l of lines){
   const m=/^(dis)?allow:\s*(\S*)$/i.exec(l);
   if(!m||!m[2])continue;
   const rule=m[2];
   if(path.startsWith(rule)&&(!best||rule.length>best.len||(rule.length===best.len&&!m[1])))best={len:rule.length,allow:!m[1]};
  }
 }
 return best?best.allow:true;
}
export function htmlToText(html:string,max=30000):{text:string;truncated:boolean}{
 let s=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<noscript[\s\S]*?<\/noscript>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ');
 s=s.replace(/<\/(p|div|li|h[1-6]|tr|section|article|br|ul|ol|table)>/gi,'\n').replace(/<[^>]+>/g,' ');
 s=s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");
 s=s.split('\n').map(l=>l.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
 const chars=[...s];
 return {text:chars.slice(0,max).join(''),truncated:chars.length>max};
}
export function pageTitle(html:string):string{
 const m=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
 return (m?htmlToText(m[1],120).text:'').slice(0,120);
}
export function importUrlProblem(raw:string):string|null{
 let u:URL;
 try{u=new URL(raw);}catch{return 'Enter a full https:// URL.';}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return 'Only http and https URLs can be imported.';
 if(u.username||u.password)return 'URLs with credentials cannot be imported.';
 if(privateHost(u.hostname))return 'Private or local addresses cannot be imported.';
 return null;
}
export function resolvedAddrsProblem(addrs:{address:string;family:number}[]):string|null{
 if(!addrs.length)return 'That address did not resolve.';
 for(const a of addrs){if(a.family===6?privateIpV6(a.address):privateIpV4(a.address))return 'That address resolves to a private network and cannot be imported.';}
 return null;
}

/* Fetch with SSRF protection on every hop (same idea as lib/webhook.ts). Each URL, including every redirect
   target, is validated, resolved once, refused if any answer is private, and then connected to that exact
   address: the socket never does its own DNS lookup, so a second answer (DNS rebinding) cannot change where
   it goes. Redirects are followed by hand, at most `maxRedirects`, and re-checked like the first URL. */
export type Addr={address:string;family:number};
export type SafeGetOptions={
 resolve?:(host:string)=>Promise<Addr[]>;
 /* Tests only: replaces the private-address check so a local server can stand in for a public one. */
 addrProblem?:(addrs:Addr[],host:string)=>string|null;
 urlProblem?:(raw:string)=>string|null;
 maxBytes?:number;maxRedirects?:number;deadline?:number;headers?:Record<string,string>;
 /* 'node' connects to the checked address (pinned). 'fetch' is used on Cloudflare Workers, which do not support
    Node's custom lookup; tests can force either. Default: 'fetch' on Workers, otherwise 'node'. */
 transport?:'node'|'fetch';
};
export type SafeGetResult={status:number;contentType:string;body:string;bytes:number;truncated:boolean;finalUrl:string};
export class ImportFetchError extends Error{constructor(message:string,public status:number){super(message);}}

function defaultResolve(host:string):Promise<Addr[]>{return dnsLookup(host,{all:true,verbatim:true});}
function pinnedRequest(u:URL,addr:Addr,o:Required<Pick<SafeGetOptions,'maxBytes'|'deadline'>>&{headers:Record<string,string>}):Promise<{status:number;location:string|null;contentType:string;body:Buffer;bytes:number;truncated:boolean}>{
 return new Promise((resolveP,rejectP)=>{
  const send=u.protocol==='https:'?httpsRequest:httpRequest;
  const left=o.deadline-Date.now();
  if(left<=0){rejectP(new ImportFetchError('The page could not be fetched within 10 seconds.',502));return;}
  // Node may ask for one address or a list depending on the connection path; answer both with the checked address.
  const lookup=(_h:string,opts:{all?:boolean},cb:(...a:unknown[])=>void)=>opts&&opts.all?cb(null,[{address:addr.address,family:addr.family}]):cb(null,addr.address,addr.family);
  const req=send(u,{method:'GET',family:addr.family,lookup:lookup as never,...(isIP(u.hostname.replace(/^\[|\]$/g,''))?{}:{servername:u.hostname}),headers:o.headers,timeout:left},res=>{
   const status=res.statusCode??0;
   if(status>=300&&status<400){res.resume();resolveP({status,location:res.headers.location??null,contentType:'',body:Buffer.alloc(0),bytes:0,truncated:false});return;}
   const chunks:Buffer[]=[];let bytes=0,truncated=false;
   res.on('data',(c:Buffer)=>{if(truncated)return;bytes+=c.length;if(bytes>o.maxBytes){chunks.push(c.subarray(0,c.length-(bytes-o.maxBytes)));truncated=true;res.destroy();finish();return;}chunks.push(c);});
   const finish=()=>resolveP({status,location:null,contentType:String(res.headers['content-type']??''),body:Buffer.concat(chunks),bytes:Math.min(bytes,o.maxBytes),truncated});
   res.on('end',finish);res.on('error',e=>{if(!truncated)rejectP(e);});
  });
  const hard=setTimeout(()=>req.destroy(new ImportFetchError('The page could not be fetched within 10 seconds.',502)),left);
  req.on('close',()=>clearTimeout(hard));
  req.on('timeout',()=>req.destroy(new ImportFetchError('The page could not be fetched within 10 seconds.',502)));
  req.on('error',e=>rejectP(e instanceof ImportFetchError?e:new ImportFetchError('The page could not be fetched within 10 seconds.',502)));
  req.end();
 });
}
/* Cloudflare Workers path. Workers cannot pin a connection to a checked address, so each hop is still validated
   and its DNS answers checked before the request, and redirects are followed by hand and re-checked. What is
   NOT guaranteed here, unlike the Node path: fetch() resolves the name again, so a rebinding answer between the
   check and the request is possible. Cloudflare documents that Workers sockets cannot reach localhost or private
   network IPs (developers.cloudflare.com/workers/runtime-apis/tcp-sockets), and fetch() uses the same outbound
   network, which is what limits that residual window to public addresses. */
const onWorkers=()=>typeof navigator!=='undefined'&&(navigator as {userAgent?:string}).userAgent==='Cloudflare-Workers';
async function fetchRequest(u:URL,o:Required<Pick<SafeGetOptions,'maxBytes'|'deadline'>>&{headers:Record<string,string>}):Promise<{status:number;location:string|null;contentType:string;body:Uint8Array;bytes:number;truncated:boolean}>{
 const left=o.deadline-Date.now();
 if(left<=0)throw new ImportFetchError('The page could not be fetched within 10 seconds.',502);
 const ctl=new AbortController(),hard=setTimeout(()=>ctl.abort(),left);
 try{
  let res:Response;
  try{res=await fetch(u.toString(),{method:'GET',redirect:'manual',headers:o.headers,signal:ctl.signal});}
  catch{throw new ImportFetchError('The page could not be fetched within 10 seconds.',502);}
  const status=res.status;
  if(status>=300&&status<400){await res.body?.cancel().catch(()=>{});return {status,location:res.headers.get('location'),contentType:'',body:new Uint8Array(0),bytes:0,truncated:false};}
  const chunks:Uint8Array[]=[];let bytes=0,truncated=false;
  const reader=res.body?.getReader();
  if(reader){
   for(;;){
    let r:ReadableStreamReadResult<Uint8Array>;
    try{r=await reader.read();}catch{throw new ImportFetchError('The page could not be fetched within 10 seconds.',502);}
    if(r.done)break;
    bytes+=r.value.length;
    if(bytes>o.maxBytes){chunks.push(r.value.subarray(0,r.value.length-(bytes-o.maxBytes)));truncated=true;await reader.cancel().catch(()=>{});break;}
    chunks.push(r.value);
   }
  }
  const body=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){body.set(c,at);at+=c.length;}
  return {status,location:null,contentType:res.headers.get('content-type')??'',body,bytes:Math.min(bytes,o.maxBytes),truncated};
 }finally{clearTimeout(hard);}
}
export async function safeGet(raw:string,opts:SafeGetOptions={}):Promise<SafeGetResult>{
 const resolve=opts.resolve??defaultResolve,addrProblem=opts.addrProblem??resolvedAddrsProblem,urlProblem=opts.urlProblem??importUrlProblem;
 const maxRedirects=opts.maxRedirects??3,maxBytes=opts.maxBytes??262144,deadline=opts.deadline??Date.now()+10000,headers=opts.headers??{},transport=opts.transport??(onWorkers()?'fetch':'node');
 let current=raw;
 for(let hop=0;hop<=maxRedirects;hop++){
  const problem=urlProblem(current);
  if(problem)throw new ImportFetchError(hop?'The page redirected to an address that cannot be imported: '+problem:problem,400);
  const u=new URL(current);
  let addrs:Addr[];
  try{addrs=await resolve(u.hostname.replace(/^\[|\]$/g,''));}catch{throw new ImportFetchError('That address did not resolve.',400);}
  const host=u.hostname.replace(/^\[|\]$/g,'');
  const ap=addrProblem(addrs,host);
  if(ap)throw new ImportFetchError(hop?'The page redirected to a private network address, so it was not followed.':ap,400);
  const r=transport==='fetch'?await fetchRequest(u,{maxBytes,deadline,headers}):await pinnedRequest(u,addrs[0],{maxBytes,deadline,headers});
  if(r.status>=300&&r.status<400){
   if(!r.location)throw new ImportFetchError('The site answered '+r.status+' without a redirect address.',502);
   current=new URL(r.location,u).toString();
   continue;
  }
  return {status:r.status,contentType:r.contentType,body:new TextDecoder('utf-8',{fatal:false}).decode(r.body),bytes:r.bytes,truncated:r.truncated,finalUrl:u.toString()};
 }
 throw new ImportFetchError('The page redirected too many times.',502);
}
