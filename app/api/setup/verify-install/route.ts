import{NextRequest,NextResponse}from'next/server';import{z}from'zod';
import dns from'node:dns/promises';
import{authenticate}from'../../../../lib/session';
import{validOrigin}from'../../../../lib/origin';
import{allowRequest}from'../../../../lib/rate-limit';
import{limitedJson}from'../../../../lib/limited-json';
import{detectWidgetScript,privateHost,privateIpV4,privateIpV6}from'../../../../lib/install-check';
// Owner-only install verification: fetches the owner's own public test page and reports
// whether the one-line widget script is present. Never stores anything; one GET per request.
const MAX_BYTES=512*1024,MAX_HOPS=3,TIMEOUT_MS=6000;
function allowedExtra(host:string):boolean{return(process.env.INSTALL_CHECK_ALLOW_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(host.toLowerCase());}
async function publicUrl(raw:string):Promise<URL>{
  const u=new URL(raw);
  if(u.protocol!=='https:'&&u.protocol!=='http:')throw new Error('Only http or https addresses.');
  if(u.username||u.password)throw new Error('Addresses with credentials are not allowed.');
  const host=u.hostname;
  if(privateHost(host)&&!allowedExtra(host))throw new Error('Only public websites can be checked.');
  if(!allowedExtra(host)){
    let addrs:{address:string;family:number}[];
    try{addrs=await dns.lookup(host,{all:true});}catch{throw new Error('That address did not resolve.');}
    if(!addrs.length||addrs.some(a=>a.family===4?privateIpV4(a.address):privateIpV6(a.address)))throw new Error('That address is not a public website.');
  }
  return u;
}
async function fetchPage(start:URL):Promise<{html:string;finalUrl:string}>{
  let u=start;
  for(let hop=0;hop<=MAX_HOPS;hop++){
    const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
    try{
      const r=await fetch(u,{redirect:'manual',signal:ctrl.signal,headers:{'User-Agent':'AutomatePal-InstallCheck/1.0 (owner-requested demo verification)',Accept:'text/html'}});
      if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error('Redirect without a location.');u=await publicUrl(new URL(loc,u).toString());continue;}
      if(!r.ok)throw new Error('That page returned HTTP '+r.status+'.');
      const reader=r.body?.getReader();if(!reader)throw new Error('That page had no readable content.');
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();break;}chunks.push(value);}
      return{html:new TextDecoder().decode(Buffer.concat(chunks)),finalUrl:u.toString()};
    }finally{clearTimeout(t);}
  }
  throw new Error('Too many redirects.');
}
export async function POST(req:NextRequest){
  const ctx=await authenticate(req);
  if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
  if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
  if(!allowRequest('verify-install:'+ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
  try{
    const b=z.object({url:z.string().trim().min(8).max(500),token:z.string().trim().max(200).optional()}).parse(await limitedJson(req,2000));
    const u=await publicUrl(b.url);
    const{html,finalUrl}=await fetchPage(u);
    const hit=detectWidgetScript(html,b.token);
    let originAllowed:boolean|null=null;
    if(hit.found){
      const{data:ws}=await ctx.client.from('widget_settings').select('controls').eq('user_id',ctx.userId).maybeSingle();
      const allowed:string[]=(ws?.controls as{allowedOrigins?:string[]}|null)?.allowedOrigins??[];
      const pageOrigin=new URL(finalUrl).origin;
      const appOrigin=process.env.NEXT_PUBLIC_APP_ORIGIN??new URL(req.url).origin;
      originAllowed=allowed.includes(pageOrigin)||pageOrigin===appOrigin;
    }
    return NextResponse.json({...hit,originAllowed,finalUrl,note:'One fetch of the address you gave, just now. Nothing was stored.'},{headers:{'Cache-Control':'no-store'}});
  }catch(e){
    if(e instanceof z.ZodError)return NextResponse.json({error:'Enter a full page address, starting with https://'},{status:400});
    const msg=e instanceof Error?e.message:'Check failed.';
    return NextResponse.json({found:false,scriptSrc:null,tokenFound:null,tokenMatches:null,error:msg.startsWith('Only')||msg.startsWith('That')||msg.startsWith('Too many')||msg.startsWith('Addresses')||msg.startsWith('Redirect')?msg:'Could not reach that page. Check the address and try again.'},{status:200,headers:{'Cache-Control':'no-store'}});
  }
}
