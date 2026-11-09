import{demoLocked}from'../../../../lib/demo-open';
import{NextRequest,NextResponse}from'next/server';import{z}from'zod';
import{authenticate}from'../../../../lib/session';
import{validOrigin}from'../../../../lib/origin';
import{allowRequest}from'../../../../lib/rate-limit';
import{limitedJson}from'../../../../lib/limited-json';
import{detectWidgetScript,privateHost,privateIpV4,privateIpV6}from'../../../../lib/install-check';
import{safeGet,ImportFetchError}from'../../../../lib/url-import';
// Owner-only install verification: fetches the owner's own public test page and reports
// whether the one-line widget script is present. Never stores anything; one GET per request.
const MAX_BYTES=512*1024,MAX_HOPS=3,TIMEOUT_MS=6000;
function allowedExtra(host:string):boolean{return(process.env.INSTALL_CHECK_ALLOW_HOSTS??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).includes(host.toLowerCase());}
/* Every hop goes through safeGet: validated, resolved once, refused if private, and connected to the checked
   address only, so neither a redirect nor a second DNS answer can reach an internal host.
   INSTALL_CHECK_ALLOW_HOSTS lists extra hosts (local test pages) that skip the private-address checks. */
function urlProblem(raw:string):string|null{
  let u:URL;try{u=new URL(raw);}catch{return 'Enter a full page address, starting with https://';}
  if(u.protocol!=='https:'&&u.protocol!=='http:')return 'Only http or https addresses.';
  if(u.username||u.password)return 'Addresses with credentials are not allowed.';
  if(privateHost(u.hostname)&&!allowedExtra(u.hostname))return 'Only public websites can be checked.';
  return null;
}
function addrProblem(addrs:{address:string;family:number}[],host:string):string|null{
  if(allowedExtra(host))return addrs.length?null:'That address did not resolve.';
  if(!addrs.length)return 'That address did not resolve.';
  return addrs.some(a=>a.family===4?privateIpV4(a.address):privateIpV6(a.address))?'That address is not a public website.':null;
}
async function fetchPage(raw:string):Promise<{html:string;finalUrl:string}>{
  const r=await safeGet(raw,{urlProblem,addrProblem,maxBytes:MAX_BYTES,maxRedirects:MAX_HOPS,deadline:Date.now()+TIMEOUT_MS,headers:{'User-Agent':'AutomatePal-InstallCheck/1.0 (owner-requested demo verification)',Accept:'text/html'}});
  if(r.status<200||r.status>=300)throw new Error('That page returned HTTP '+r.status+'.');
  return{html:r.body,finalUrl:r.finalUrl};
}
export async function POST(req:NextRequest){
  const ctx=await authenticate(req);
  if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
  if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
  if(!await allowRequest('verify-install:'+ctx.actorId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
  try{
    const b=z.object({url:z.string().trim().min(8).max(500),token:z.string().trim().max(200).optional()}).parse(await limitedJson(req,2000));
    const{html,finalUrl}=await fetchPage(b.url);
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
    if(e instanceof ImportFetchError&&e.status===400)return NextResponse.json({found:false,scriptSrc:null,tokenFound:null,tokenMatches:null,error:msg},{status:200,headers:{'Cache-Control':'no-store'}});
    return NextResponse.json({found:false,scriptSrc:null,tokenFound:null,tokenMatches:null,error:msg.startsWith('Only')||msg.startsWith('That')||msg.startsWith('Too many')||msg.startsWith('Addresses')||msg.startsWith('Redirect')?msg:'Could not reach that page. Check the address and try again.'},{status:200,headers:{'Cache-Control':'no-store'}});
  }
}
