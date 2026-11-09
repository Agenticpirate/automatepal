import{demoLocked}from'../../../../lib/demo-open';
import{NextRequest,NextResponse}from'next/server';
import{authenticate}from'../../../../lib/session';
import{allowRequest}from'../../../../lib/rate-limit';
import{validOrigin}from'../../../../lib/origin';
import{importUrlProblem,robotsAllowed,htmlToText,pageTitle,safeGet,ImportFetchError}from'../../../../lib/url-import';
const MAX=262144;
const UA='AutomatePal-owner-import/1.0';
/* One public page, fetched for the owner to review. Every hop (robots.txt, the page and each redirect) goes through
   safeGet: validated, resolved once, refused if private, and connected to the checked address only. */
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 const ctx=await authenticate(req);if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!await allowRequest('url-import:'+ctx.actorId))return NextResponse.json({error:'Please wait a minute between imports.'},{status:429});
 let body:{url?:string};try{body=await req.json();}catch{return NextResponse.json({error:'Invalid request.'},{status:400});}
 const url=(body?.url??'').slice(0,500);
 const problem=importUrlProblem(url);if(problem)return NextResponse.json({error:problem},{status:400});
 const u=new URL(url);
 const deadline=Date.now()+10000;
 try{
  let robots='';
  // A missing or failing robots.txt means no robot rules, except that a private-address refusal still stops the import.
  try{const r=await safeGet(u.origin+'/robots.txt',{deadline,maxBytes:20000,headers:{'user-agent':UA}});if(r.status>=200&&r.status<300)robots=r.body;}
  catch(e){if(e instanceof ImportFetchError&&e.status===400)throw e;}
  if(!robotsAllowed(robots,u.pathname))return NextResponse.json({error:'That site disallows this path in robots.txt. Add the text by file or paste instead.'},{status:403});
  const page=await safeGet(u.toString(),{deadline,maxBytes:MAX,headers:{'user-agent':UA,accept:'text/html'}});
  if(page.status<200||page.status>=300)return NextResponse.json({error:'The site answered '+page.status+'. Add the text by file or paste instead.'},{status:502});
  if(!page.contentType.toLowerCase().includes('text/html'))return NextResponse.json({error:'Only public web pages (HTML) can be imported. Use the file import for TXT/MD/CSV/PDF.'},{status:400});
  const {text:extracted,truncated:textTruncated}=htmlToText(page.body);
  if([...extracted].length<20)return NextResponse.json({error:'The page gave too little readable text. Add the content by file or paste instead.'},{status:422});
  const fin=new URL(page.finalUrl);
  return NextResponse.json({title:pageTitle(page.body)||fin.hostname,content:extracted,fetchedBytes:page.bytes,truncated:page.truncated||textTruncated,sourceUrl:fin.origin+fin.pathname,note:'Fetched one page only. Review the extracted text; nothing is saved or published until you choose it.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  if(e instanceof ImportFetchError)return NextResponse.json({error:e.message},{status:e.status});
  return NextResponse.json({error:'The page could not be fetched within 10 seconds.'},{status:502});
 }
}
