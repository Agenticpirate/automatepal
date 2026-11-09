import{demoLocked}from'../../../../lib/demo-open';
import{NextRequest,NextResponse}from'next/server';
import{z}from'zod';
import{authenticate,roleAtLeast}from'../../../../lib/session';
import{allowRequest}from'../../../../lib/rate-limit';
import{validOrigin}from'../../../../lib/origin';
import{limitedJson}from'../../../../lib/limited-json';
import{crawlSite,parseLinkList,MAX_PAGES,MAX_DEPTH}from'../../../../lib/crawl';
import{ImportFetchError}from'../../../../lib/url-import';
import{contextDevRenderer,contextDevAvailable}from'../../../../lib/context-dev';
import{importGithubDocs,parseGithubRepo,GITHUB_MAX_FILES}from'../../../../lib/github-import';

/* Owner-only website crawl for review. Fetches up to MAX_PAGES pages inside one request and returns them as
   Markdown; nothing is saved, embedded or published here. The owner then picks pages in the knowledge
   workspace and saves each through the existing consent-checked /api/knowledge path. */
export const maxDuration=60;
const list=z.array(z.string().trim().min(1).max(200)).max(20).default([]);
const body=z.object({
 mode:z.enum(['site','sitemap','links','github']),
 url:z.string().trim().max(500).optional(),
 links:z.string().max(20000).optional(),
 depth:z.number().int().min(1).max(MAX_DEPTH).default(2),
 maxPages:z.number().int().min(1).max(MAX_PAGES).default(20),
 includePaths:list,excludePaths:list,allowedDomains:list,includeSelectors:list,excludeSelectors:list,
 mainContentOnly:z.boolean().default(true),
 skipUrls:z.array(z.string().max(500)).max(300).default([]),
 useBrowserRendering:z.boolean().default(false),
});
/* Limits only, so the import form can label its options. Signed-out visitors (the open demo) get the same
   limits with browser rendering reported off; nothing here reveals account data. */
export async function GET(req:NextRequest){
 const ctx=await authenticate(req);
 return NextResponse.json({maxPages:MAX_PAGES,maxDepth:MAX_DEPTH,browserRendering:!!ctx&&contextDevAvailable()},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:NextRequest){
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 const ctx=await authenticate(req);if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 // Agents can read knowledge but not change it, matching the database rule for knowledge edits.
 if(!roleAtLeast(ctx.role,'manager'))return NextResponse.json({error:'Only managers, admins and owners can import website content.'},{status:403});
 if(!await allowRequest('crawl:'+ctx.actorId))return NextResponse.json({error:'Please wait a minute between website imports.'},{status:429});
 let b:z.infer<typeof body>;
 try{b=body.parse(await limitedJson(req,40000));}catch{return NextResponse.json({error:'Check the import settings and try again.'},{status:400});}
 // GitHub docs (Phase 3): Markdown and text files from a public repository, same review list.
 if(b.mode==='github'){
  const repo=parseGithubRepo(b.url??'');if(!repo)return NextResponse.json({error:'Enter a public GitHub repository, such as https://github.com/owner/repo or https://github.com/owner/repo/tree/main/docs'},{status:400});
  try{const r=await importGithubDocs(repo,{maxFiles:Math.min(b.maxPages,GITHUB_MAX_FILES),skipUrls:b.skipUrls,deadline:Date.now()+50_000});return NextResponse.json({...r,notLinks:[],browserRenders:0,note:'Docs read from GitHub for your review. Nothing is saved or published until you choose pages and confirm processing consent.'},{headers:{'Cache-Control':'no-store'}});}
  catch(e){if(e instanceof ImportFetchError)return NextResponse.json({error:e.message},{status:e.status});return NextResponse.json({error:'The GitHub import failed. Check the repository address and try again.'},{status:502});}
 }
 let links:string[]|undefined,notLinks:string[]=[];
 if(b.mode==='links'){const p=parseLinkList(b.links??'');links=p.links.slice(0,b.maxPages);notLinks=p.notLinks.slice(0,20);if(!links.length)return NextResponse.json({error:'Add at least one link, such as https://example.com/pricing',notLinks},{status:400});}
 else if(!b.url)return NextResponse.json({error:b.mode==='sitemap'?'Enter the sitemap URL, such as https://example.com/sitemap.xml':'Enter the website URL to start from.'},{status:400});
 const renderer=b.useBrowserRendering?contextDevRenderer():null;
 const abort=new AbortController();req.signal.addEventListener('abort',()=>abort.abort());
 try{
  const r=await crawlSite({mode:b.mode,url:b.url,links,depth:b.depth,maxPages:b.maxPages,includePaths:b.includePaths,excludePaths:b.excludePaths,allowedDomains:b.allowedDomains,includeSelectors:b.includeSelectors,excludeSelectors:b.excludeSelectors,mainContentOnly:b.mainContentOnly,skipUrls:b.skipUrls,renderFallback:renderer??undefined,deadline:Date.now()+50000,signal:abort.signal});
  return NextResponse.json({...r,notLinks,browserRenders:renderer?renderer.used():0,note:'Crawled for your review. Nothing is saved or published until you choose pages and confirm processing consent.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){
  if(e instanceof ImportFetchError)return NextResponse.json({error:e.message},{status:e.status});
  return NextResponse.json({error:'The website import failed. Try again, or add pages as a list of links.'},{status:502});
 }
}
