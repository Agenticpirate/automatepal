import{NextRequest,NextResponse}from'next/server';
import dns from'node:dns/promises';
import{authenticate}from'../../../../lib/session';
import{allowRequest}from'../../../../lib/rate-limit';
import{validOrigin}from'../../../../lib/origin';
import{importUrlProblem,resolvedAddrsProblem,robotsAllowed,htmlToText,pageTitle}from'../../../../lib/url-import';
const MAX=262144;
async function readCapped(res:Response):Promise<{text:string;bytes:number;truncated:boolean}>{
 const reader=res.body?.getReader();if(!reader)return{text:'',bytes:0,truncated:false};
 const chunks:Uint8Array[]=[];let bytes=0,truncated=false;
 for(;;){const{done,value}=await reader.read();if(done)break;if(value){bytes+=value.byteLength;if(bytes>MAX){chunks.push(value.subarray(0,Math.max(0,value.byteLength-(bytes-MAX))));truncated=true;await reader.cancel();break;}chunks.push(value);}}
 const merged=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let off=0;for(const c of chunks){merged.set(c,off);off+=c.length;}
 return{text:new TextDecoder('utf-8',{fatal:false}).decode(merged),bytes,truncated};
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 const ctx=await authenticate(req);if(!ctx)return NextResponse.json({error:'Please sign in.'},{status:401});
 if(!allowRequest('url-import:'+ctx.userId))return NextResponse.json({error:'Please wait a minute between imports.'},{status:429});
 let body:{url?:string};try{body=await req.json();}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
 const url=(body?.url??'').slice(0,500);
 const problem=importUrlProblem(url);if(problem)return NextResponse.json({error:problem},{status:400});
 const u=new URL(url);
 let addrs;try{addrs=await dns.lookup(u.hostname,{all:true});}catch{return NextResponse.json({error:'That address did not resolve.'},{status:400});}
 const addrProblem=resolvedAddrsProblem(addrs);if(addrProblem)return NextResponse.json({error:addrProblem},{status:400});
 const timeout=AbortSignal.timeout(10000);
 let robots='';
 try{const r=await fetch(u.origin+'/robots.txt',{signal:timeout,redirect:'follow',headers:{'user-agent':'AutomatePal-owner-import/1.0'}});if(r.ok)robots=(await r.text()).slice(0,20000);}catch{/* Missing robots.txt means no robot rules. */}
 if(!robotsAllowed(robots,u.pathname))return NextResponse.json({error:'That site disallows this path in robots.txt. Add the text by file or paste instead.'},{status:403});
 let page;try{page=await fetch(u,{signal:timeout,redirect:'follow',headers:{'user-agent':'AutomatePal-owner-import/1.0','accept':'text/html'}});}catch{return NextResponse.json({error:'The page could not be fetched within 10 seconds.'},{status:502});}
 if(!page.ok)return NextResponse.json({error:'The site answered '+page.status+'. Add the text by file or paste instead.'},{status:502});
 if(!(page.headers.get('content-type')??'').toLowerCase().includes('text/html'))return NextResponse.json({error:'Only public web pages (HTML) can be imported. Use the file import for TXT/MD/CSV/PDF.'},{status:400});
 const {text,bytes,truncated:bodyTruncated}=await readCapped(page);
 const {text:extracted,truncated:textTruncated}=htmlToText(text);
 if([...extracted].length<20)return NextResponse.json({error:'The page gave too little readable text. Add the content by file or paste instead.'},{status:422});
 return NextResponse.json({title:pageTitle(text)||u.hostname,content:extracted,fetchedBytes:bytes,truncated:bodyTruncated||textTruncated,sourceUrl:u.origin+u.pathname,note:'Fetched one page only. Review the extracted text; nothing is saved or published until you choose it.'},{headers:{'Cache-Control':'no-store'}});
}
