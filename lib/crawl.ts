// Website crawl for knowledge import (server-only). Finds pages from a sitemap, a list of links, or by following
// same-host links from a start URL, fetches each one through safeGet (SSRF-checked on every hop, pinned DNS),
// respects robots.txt, and turns each page into clean Markdown with Mozilla Readability + Turndown.
// Pages that render almost nothing without JavaScript can be handed to Context.dev (lib/context-dev.ts) when
// the owner allows it. Nothing here saves or publishes: results go to the owner's review list.
// Design mirrors SiteGPT's documented options (depth 1-5, page cap, include/exclude paths, allowed domains,
// main-content extraction, CSS selectors to keep/remove, sitemap indexes) with two deliberate differences:
// robots.txt is honoured, and every fetch is SSRF-guarded.
import {parseHTML} from 'linkedom';
import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {safeGet,robotsAllowed,importUrlProblem,ImportFetchError,type SafeGetOptions} from './url-import';

export type CrawlMode='site'|'sitemap'|'links';
export type CrawlOptions={
 mode:CrawlMode;
 /* site: the start URL. sitemap: the sitemap URL. links: ignored (use `links`). */
 url?:string;
 links?:string[];
 depth?:number;              // site mode: 1-5, like SiteGPT's "Recursion Depth"
 maxPages?:number;           // hard cap on pages fetched, also bounded by MAX_PAGES and the remaining quota
 includePaths?:string[];     // plain substring match on the URL path, like SiteGPT
 excludePaths?:string[];     // checked before include
 allowedDomains?:string[];   // extra hostnames whose pages may be added but not followed
 includeSelectors?:string[]; // keep only content inside these elements
 excludeSelectors?:string[]; // remove these elements before extraction
 mainContentOnly?:boolean;   // default true: Readability main content; false keeps the whole <body>
 skipUrls?:string[];         // already-imported URLs ("Skip pages that are already trained")
 renderFallback?:(url:string)=>Promise<{markdown:string;title:string}|null>; // JS-rendered pages
 /* Tests only. */
 fetchOptions?:Pick<SafeGetOptions,'resolve'|'addrProblem'|'urlProblem'>;
 delayMs?:number;            // politeness delay between requests to the same host, default 1000
 deadline?:number;           // absolute ms timestamp for the whole crawl, default now + 50 s
 signal?:AbortSignal;
};
export type CrawledPage={url:string;title:string;markdown:string;chars:number;pageUnits:number;via:'html'|'render'};
export type SkippedPage={url:string;reason:string};
export type CrawlResult={pages:CrawledPage[];skipped:SkippedPage[];discovered:number;truncated:boolean;stoppedBy?:string};

export const MAX_PAGES=50;          // per crawl request; the request must finish inside one serverless invocation
export const MAX_DEPTH=5;
export const MIN_TEXT_CHARS=40;     // shorter than this is not a usable source page
export const THIN_TEXT_CHARS=200;   // below this, a page that looks like a JavaScript app is sent to browser rendering
const MAX_SITEMAP_URLS=5000;        // URLs read from sitemaps before filtering
const MAX_PAGE_CHARS=30000;         // same cap as single-URL import and knowledge sources
const MAX_SITEMAP_BYTES=5_000_000;
const MAX_SITEMAPS=10;              // nested sitemap files followed per crawl
const PAGE_UNIT=2500;               // one page unit = 2500 characters, same as knowledge quota
const UA='AutomatePal-owner-import/1.0 (+site owner requested crawl)';
const SKIP_EXT=/\.(?:jpe?g|png|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|mov|avi|webm|wav|ogg|zip|gz|tgz|rar|7z|dmg|exe|msi|apk|css|js|mjs|json|xml|rss|atom|woff2?|ttf|eot|pdf)(?:$|\?)/i;

/* ---------- URL helpers ---------- */
export function normalizeUrl(raw:string,base?:string):string|null{
 let u:URL;try{u=new URL(raw,base);}catch{return null;}
 if(u.protocol!=='https:'&&u.protocol!=='http:')return null;
 u.hash='';
 // Tracking parameters create duplicate pages; strip the common ones, keep everything else.
 for(const k of [...u.searchParams.keys()])if(/^(?:utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|ref_src)$/i.test(k))u.searchParams.delete(k);
 u.searchParams.sort();
 if(u.pathname!=='/'&&u.pathname.endsWith('/'))u.pathname=u.pathname.replace(/\/+$/,'');
 u.hostname=u.hostname.toLowerCase();
 return u.toString();
}
/* SiteGPT-style list repair: one link per line, quotes/brackets/commas removed, https:// added, de-duplicated. */
export function parseLinkList(text:string):{links:string[];notLinks:string[]}{
 const tokens=text.split(/[\s,;]+/).map(t=>t.trim().replace(/^[<("'\[]+|[>)"'\]]+$/g,'')).filter(Boolean);
 const links:string[]=[],notLinks:string[]=[],seen=new Set<string>();
 for(const t of tokens){
  const candidate=/^https?:\/\//i.test(t)?t:/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(t)?'https://'+t:null;
  const n=candidate?normalizeUrl(candidate):null;
  if(!n){notLinks.push(t);continue;}
  if(!seen.has(n)){seen.add(n);links.push(n);}
 }
 return{links,notLinks};
}
export function pathAllowed(url:string,include:string[]=[],exclude:string[]=[]):boolean{
 const p=new URL(url).pathname+new URL(url).search;
 if(exclude.some(x=>x&&p.includes(x)))return false;
 return !include.length||include.some(x=>x&&p.includes(x));
}

/* ---------- Sitemaps ---------- */
export function parseSitemap(xml:string):{pages:string[];sitemaps:string[]}{
 const locs=(tag:string)=>[...xml.matchAll(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<loc>\\s*([^<\\s]+)\\s*</loc>','gi'))].map(m=>decodeXml(m[1]));
 return{pages:locs('url'),sitemaps:locs('sitemap')};
}
function decodeXml(s:string){return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
export function robotsSitemaps(robots:string):string[]{return [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m=>m[1]);}

/* ---------- HTML to Markdown ---------- */
const turndown=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});
turndown.remove(['script','style','noscript','iframe','svg','canvas','form','button','select','input','textarea'] as never);
export function htmlToMarkdown(html:string,url:string,o:{mainContentOnly?:boolean;includeSelectors?:string[];excludeSelectors?:string[]}={}):{title:string;markdown:string;links:string[]}{
 // linkedom gives a fragment no <body>; wrap it so body-level extraction works on partial HTML too.
 if(!/<html\b/i.test(html))html='<!doctype html><html><head></head><body>'+html+'</body></html>';
 const {document}=parseHTML(html);
 const title=(document.querySelector('title')?.textContent??'').replace(/\s+/g,' ').trim().slice(0,200);
 const links=[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')??'').filter(h=>h&&!/^(?:mailto|tel|javascript|data):/i.test(h));
 for(const sel of o.excludeSelectors??[])safeQueryAll(document,sel).forEach(n=>n.remove());
 let root:{innerHTML:string}|null=null;
 const keep=(o.includeSelectors??[]).flatMap(sel=>safeQueryAll(document,sel));
 if(keep.length)root={innerHTML:keep.map(n=>n.outerHTML).join('\n')};
 else if(o.mainContentOnly!==false){
  // Readability mutates the document, so it runs on its own parse.
  const article=new Readability(parseHTML(html).document as never,{charThreshold:100}).parse();
  // Readability drops the main heading when it repeats the page title; keep it, since it helps retrieval.
  if(article?.content)root={innerHTML:(article.title&&!/<h1\b/i.test(article.content)?'<h1>'+escapeHtml(article.title)+'</h1>':'')+article.content};
 }
 if(!root){for(const sel of ['nav','header','footer','aside','[role=navigation]','[aria-hidden=true]','.cookie','#cookie-banner'])safeQueryAll(document,sel).forEach(n=>n.remove());root={innerHTML:document.body?.innerHTML??document.documentElement?.innerHTML??''};}
 // Hand Turndown a parsed linkedom element, not a string: its browser build (the one bundled for Cloudflare
 // Workers) parses strings with the global `document`, which Workers do not have.
 const holder=parseHTML('<!doctype html><html><head></head><body><div id="ap-md-root">'+root.innerHTML+'</div></body></html>').document.getElementById('ap-md-root');
 let md=holder?turndown.turndown(holder as never):'';
 md=md.replace(/!\[[^\]]*\]\((?:data:[^)]*|[^)]{300,})\)/g,'')   // inline image data and huge image URLs
      .replace(/\[([^\]]+)\]\((?:javascript:|data:)[^)]*\)/gi,'$1')
      .replace(/\n{3,}/g,'\n\n').trim();
 void url;
 return{title,markdown:md.slice(0,MAX_PAGE_CHARS),links};
}
function escapeHtml(s:string){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function safeQueryAll(doc:ReturnType<typeof parseHTML>['document'],sel:string){try{return [...doc.querySelectorAll(sel)];}catch{return [];}}

/* ---------- Crawl ---------- */
type Queued={url:string;depth:number;follow:boolean};
export async function crawlSite(o:CrawlOptions):Promise<CrawlResult>{
 const depthLimit=Math.max(0,Math.min(MAX_DEPTH,Math.floor(o.depth??2)));
 const cap=Math.max(1,Math.min(MAX_PAGES,Math.floor(o.maxPages??20)));
 const deadline=o.deadline??Date.now()+50_000;
 const delay=o.delayMs??1000;
 const fetchBase={...(o.fetchOptions??{}),headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5'}};
 const pages:CrawledPage[]=[],skipped:SkippedPage[]=[];
 const seen=new Set<string>((o.skipUrls??[]).map(u=>normalizeUrl(u)).filter((u):u is string=>!!u));
 const contentHashes=new Set<string>();
 const robotsByOrigin=new Map<string,string>();
 const lastHit=new Map<string,number>();
 const allowed=new Set((o.allowedDomains??[]).map(d=>d.toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'')).filter(Boolean));
 let stoppedBy:string|undefined;let discovered=0;
 const timeLeft=()=>deadline-Date.now();
 const stop=()=>{if(o.signal?.aborted){stoppedBy='cancelled';return true;}if(timeLeft()<3000){stoppedBy='time limit';return true;}return false;};

 async function polite(host:string){const wait=(lastHit.get(host)??0)+delay-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));lastHit.set(host,Date.now());}
 async function get(url:string,maxBytes:number){
  const host=new URL(url).host;await polite(host);
  return safeGet(url,{...fetchBase,maxBytes,deadline:Math.min(deadline,Date.now()+10_000)});
 }
 async function robotsFor(url:string){
  const origin=new URL(url).origin;
  if(!robotsByOrigin.has(origin)){
   let txt='';
   try{const r=await get(origin+'/robots.txt',100_000);if(r.status>=200&&r.status<300)txt=r.body;}
   catch(e){if(e instanceof ImportFetchError&&e.status===400)throw e;}  // private-address refusal stops the crawl
   robotsByOrigin.set(origin,txt);
  }
  return robotsByOrigin.get(origin)!;
 }

 // 1. Seed the queue.
 let seeds:Queued[]=[];
 const rootHost=o.url?safeHost(o.url):null;
 if(o.mode==='links'){
  seeds=(o.links??[]).map(u=>normalizeUrl(u)).filter((u):u is string=>!!u).map(url=>({url,depth:0,follow:false}));
 }else{
  const start=normalizeUrl(o.url??'');
  const problem=start?importUrlProblem(start):'Enter a full https:// URL.';
  if(problem||!start)throw new ImportFetchError(problem??'Enter a full https:// URL.',400);
  if(o.mode==='sitemap'){
   // Like SiteGPT, only URLs on the sitemap's own hostname (plus allowed domains) are added. Filters run on the
   // full sitemap before the page cap, so "only /docs" finds docs pages even when they are listed last.
   const keep=(u:string)=>{const n=normalizeUrl(u);if(!n)return null;const h=new URL(n).hostname;return (h===rootHost||allowed.has(h))&&pathAllowed(n,o.includePaths,o.excludePaths)&&!SKIP_EXT.test(new URL(n).pathname)?n:null;};
   const urls=(await readSitemaps(start,get,keep,cap*4,stop)).urls;
   seeds=urls.map(url=>({url,depth:0,follow:false}));
   if(!seeds.length)skipped.push({url:start,reason:'The sitemap listed no pages on '+rootHost+'.'});
  }else{
   seeds=[{url:start,depth:0,follow:true}];
  }
 }
 const queue:Queued[]=[];
 for(const s of seeds){if(!seen.has(s.url)){seen.add(s.url);queue.push(s);}}
 discovered=queue.length;

 // 2. Fetch breadth-first.
 while(queue.length&&pages.length<cap){
  if(stop())break;
  const item=queue.shift()!;
  const {url}=item;
  if(SKIP_EXT.test(new URL(url).pathname)){skipped.push({url,reason:'Not a web page (file type).'});continue;}
  if(o.mode!=='links'&&!pathAllowed(url,o.includePaths,o.excludePaths)){skipped.push({url,reason:'Filtered out by your include/exclude paths.'});continue;}
  try{
   const robots=await robotsFor(url);
   const u=new URL(url);
   if(!robotsAllowed(robots,u.pathname)){skipped.push({url,reason:'robots.txt disallows this path.'});continue;}
   const r=await get(url,1_000_000);
   if(r.status===404||r.status===410){skipped.push({url,reason:'The page could not be found ('+r.status+').'});continue;}
   if(r.status===401||r.status===403){skipped.push({url,reason:'The site blocked access ('+r.status+').'});continue;}
   if(r.status<200||r.status>=300){skipped.push({url,reason:'The site answered '+r.status+'.'});continue;}
   if(!/text\/html|application\/xhtml/i.test(r.contentType)){skipped.push({url,reason:'Not an HTML page ('+(r.contentType.split(';')[0]||'unknown type')+').'});continue;}
   const finalUrl=normalizeUrl(r.finalUrl)??url;
   if(finalUrl!==url){
    // Redirect to a page we already have (www/no-www, trailing slash): count it once.
    if(seen.has(finalUrl)&&pages.some(p=>p.url===finalUrl)){skipped.push({url,reason:'Same page as '+finalUrl+'.'});continue;}
    seen.add(finalUrl);
   }
   const ex=htmlToMarkdown(r.body,finalUrl,o);
   let markdown=ex.markdown,title=ex.title,via:'html'|'render'='html';
   // Paid rendering only for thin pages that look like JavaScript apps; a short static page keeps its own text.
   if(markdown.length<THIN_TEXT_CHARS&&o.renderFallback&&looksJsRendered(r.body)){
    const rendered=await o.renderFallback(finalUrl).catch(()=>null);
    if(rendered&&rendered.markdown.length>markdown.length){markdown=rendered.markdown.slice(0,MAX_PAGE_CHARS);title=rendered.title||title;via='render';}
   }
   const jsApp=markdown.length<THIN_TEXT_CHARS&&via==='html'&&looksJsRendered(r.body);
   if(markdown.length<MIN_TEXT_CHARS||(jsApp&&!o.renderFallback)){skipped.push({url:finalUrl,reason:jsApp?(o.renderFallback?'Too little readable text, even after browser rendering.':'Too little readable text. The page probably needs a browser to render it.'):'Too little readable text on this page.'});}
   else{
    const h=hash(markdown);
    if(contentHashes.has(h))skipped.push({url:finalUrl,reason:'Duplicate content of a page already added.'});
    else{contentHashes.add(h);pages.push({url:finalUrl,title:title||new URL(finalUrl).pathname,markdown,chars:markdown.length,pageUnits:Math.ceil(markdown.length/PAGE_UNIT),via});}
   }
   // 3. Follow links (site mode only), same host, plus allowed domains added but not followed.
   if(o.mode==='site'&&item.follow&&item.depth<depthLimit){
    for(const href of ex.links){
     const n=normalizeUrl(href,finalUrl);if(!n||seen.has(n))continue;
     const h=new URL(n).hostname;
     const sameHost=h===rootHost;
     if(!sameHost&&!allowed.has(h))continue;
     if(SKIP_EXT.test(new URL(n).pathname))continue;
     seen.add(n);discovered++;
     if(queue.length<cap*4)queue.push({url:n,depth:item.depth+1,follow:sameHost});
    }
   }
  }catch(e){
   if(e instanceof ImportFetchError&&e.status===400&&/private network|cannot be imported/i.test(e.message)){skipped.push({url,reason:e.message});continue;}
   skipped.push({url,reason:e instanceof Error?e.message:'Fetch failed.'});
  }
 }
 const truncated=pages.length>=cap&&queue.length>0;
 if(truncated&&!stoppedBy)stoppedBy='page limit';
 return{pages,skipped,discovered,truncated,stoppedBy};
}

/* Page URLs listed by a sitemap (and nested sitemaps) on the sitemap's own hostname, for the scheduled
   refresh. Same safeGet (SSRF checks on every hop), size caps and politeness delay as crawlSite.
   `complete` is true only when every sitemap file was read and no URL, file or time cap cut the list short,
   so the caller can treat "not listed" as a removal signal only for a complete read. */
export async function listSitemapUrls(url:string,o:{max?:number;fetchOptions?:CrawlOptions['fetchOptions'];delayMs?:number;deadline?:number;signal?:AbortSignal}={}):Promise<SitemapRead>{
 const start=normalizeUrl(url);const problem=start?importUrlProblem(start):'Enter a full https:// URL.';
 if(problem||!start)throw new ImportFetchError(problem??'Enter a full https:// URL.',400);
 const host=new URL(start).hostname,deadline=o.deadline??Date.now()+20_000,delay=o.delayMs??1000;let last=0;
 const get=async(u:string,maxBytes:number)=>{const wait=last+delay-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));last=Date.now();return safeGet(u,{...(o.fetchOptions??{}),headers:{'user-agent':UA,accept:'application/xml,text/xml;q=0.9,*/*;q=0.5'},maxBytes,deadline:Math.min(deadline,Date.now()+10_000)});};
 const keep=(u:string)=>{const n=normalizeUrl(u);return n&&new URL(n).hostname===host&&!SKIP_EXT.test(new URL(n).pathname)?n:null;};
 return readSitemaps(start,get,keep,Math.max(1,Math.min(o.max??500,MAX_SITEMAP_URLS)),()=>!!o.signal?.aborted||deadline-Date.now()<2000);
}
export type SitemapRead={urls:string[];complete:boolean};
async function readSitemaps(start:string,get:(u:string,b:number)=>Promise<{status:number;body:string;contentType:string}>,keep:(u:string)=>string|null,want:number,stop:()=>boolean):Promise<SitemapRead>{
 const pages:string[]=[];const queue=[start];const done=new Set<string>();const have=new Set<string>();let read=0,complete=true;
 while(queue.length){
  const sm=queue.shift()!;if(done.has(sm))continue;
  // A file left unread (file, URL or time cap) or one that failed makes the list incomplete.
  if(done.size>=MAX_SITEMAPS||pages.length>=want||read>=MAX_SITEMAP_URLS||stop()){complete=false;break;}
  done.add(sm);
  let r;try{r=await get(sm,MAX_SITEMAP_BYTES);}catch(e){if(e instanceof ImportFetchError&&e.status===400)throw e;complete=false;continue;}
  if(r.status<200||r.status>=300){complete=false;continue;}
  if(/\.gz$/i.test(sm)||/gzip/i.test(r.contentType)){complete=false;continue;} // compressed sitemaps are not supported
  const p=parseSitemap(r.body);
  for(let i=0;i<p.pages.length;i++){read++;const k=keep(p.pages[i]);if(k&&!have.has(k)){have.add(k);pages.push(k);}if(pages.length>=want||read>=MAX_SITEMAP_URLS){if(i<p.pages.length-1)complete=false;break;}}
  for(const s of p.sitemaps)if(!done.has(s))queue.push(s);
 }
 return{urls:pages.slice(0,want),complete};
}
/* A page whose HTML is mostly an empty app shell: scripts plus a mount point or a "needs JavaScript" notice. */
export function looksJsRendered(html:string):boolean{
 if(!/<script\b/i.test(html))return false;
 return /id=["'](?:root|app|__next|__nuxt|svelte|main-app)["']|ng-app|data-reactroot|<noscript[^>]*>[\s\S]{0,400}?(?:enable|requires?)\s+javascript/i.test(html)||((html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi,'').replace(/\s+/g,' ').trim().length)<80);
}
function safeHost(u:string){try{return new URL(u).hostname.toLowerCase();}catch{return null;}}
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36)+':'+s.length;}
