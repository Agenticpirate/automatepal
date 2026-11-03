/* Scheduled website refresh (server-only). For one workspace: re-crawl its saved website sources, compare each
   page with the saved text, and use the optional sitemap to find new and removed pages. Results go to the
   owner's review queue (db/050 knowledge_refresh_items); nothing is published or overwritten here, so the
   existing consent rules apply when the owner saves a change through Knowledge.
   Bounded per run: at most MAX_RECHECK saved pages and MAX_NEW new pages are fetched (one crawlSite call,
   same safeGet/robots.txt/size caps as the owner's import), and the run stops at its deadline. Saved pages
   rotate (least recently re-checked first) and the sitemap is remembered between runs (db/052). Absence from
   the sitemap counts as a removal only when the whole sitemap was read and only for pages on the sitemap's
   own host (the only host it lists), and a dismissed removal is not proposed again while the page stays
   gone (db/053). */
import type {SupabaseClient} from '@supabase/supabase-js';
import {crawlSite,listSitemapUrls,normalizeUrl,type CrawlOptions,type CrawlResult} from './crawl';

export const MAX_RECHECK=15;
export const MAX_NEW=5;
const HEADER=/^Source: (https?:\/\/\S+)\n\n/;
export type SavedSource={id:string;title:string;content:string;updatedAt:string;published:boolean;checkedAt?:string|null};
export type RefreshItem={kind:'new'|'changed'|'removed';url:string;title:string;documentId?:string;content?:string};
export type RefreshSummary={checked:number;changed:number;added:number;removed:number;skipped:number;sitemap:'none'|'read'|'partial'|'failed';sitemapBaseline?:boolean;stoppedBy?:string};

export const sourceUrl=(content:string)=>{const m=content.match(HEADER);return m?normalizeUrl(m[1]):null;};
/* The exact text the website import saves for a page, so a re-crawl compares like with like. */
export const savedText=(url:string,markdown:string)=>('Source: '+url+'\n\n'+markdown).slice(0,30000);
const same=(a:string,b:string)=>a.replace(/\s+/g,' ').trim()===b.replace(/\s+/g,' ').trim();
const gone=(reason:string)=>/\((?:404|410)\)/.test(reason);
const hostOf=(u:string)=>{try{return new URL(u).hostname;}catch{return null;}};

/* Pure comparison, unit-tested. `listed` is the sitemap's URL list from a complete read, or null when no
   sitemap was read or the read was partial (then only a 404/410 on re-check proposes a removal).
   `sitemapHost` is the hostname listSitemapUrls kept URLs for: absence from the list is a removal signal
   only for saved pages on that host; pages on other hosts are removed only on a 404/410. */
export function diffRefresh(saved:SavedSource[],listed:string[]|null,crawl:Pick<CrawlResult,'pages'|'skipped'>,newUrls:string[],sitemapHost:string|null=null):RefreshItem[]{
 const items:RefreshItem[]=[];const pages=new Map(crawl.pages.map(p=>[normalizeUrl(p.url)??p.url,p]));
 const skipped=new Map(crawl.skipped.map(s=>[normalizeUrl(s.url)??s.url,s.reason]));
 const inSitemap=listed?new Set(listed.map(u=>normalizeUrl(u)).filter(Boolean)):null;
 for(const s of saved){
  const url=sourceUrl(s.content);if(!url)continue;
  const page=pages.get(url);
  if(page){const next=savedText(url,page.markdown);if(next.length>=20&&!same(next,s.content))items.push({kind:'changed',url,title:s.title,documentId:s.id,content:next});continue;}
  const reason=skipped.get(url);
  if((reason&&gone(reason))||(inSitemap&&inSitemap.size>0&&!!sitemapHost&&hostOf(url)===sitemapHost&&!inSitemap.has(url)))items.push({kind:'removed',url,title:s.title,documentId:s.id});
 }
 for(const u of newUrls){const page=pages.get(u);if(page){const content=savedText(u,page.markdown);if(content.length>=20)items.push({kind:'new',url:u,title:(page.title||u).slice(0,120),content});}}
 return items;
}

/* Rotation (db/052): pick up to MAX_RECHECK distinct page URLs, least recently re-checked first (never
   checked first), keeping the database order for ties. Pure, unit-tested. */
export function pickRecheck(saved:SavedSource[],eligible:(url:string)=>boolean,max=MAX_RECHECK):string[]{
 const at=(s:SavedSource)=>s.checkedAt?Date.parse(s.checkedAt)||0:-Infinity;
 const urls:string[]=[];const seen=new Set<string>();
 for(const s of saved.map((s,i)=>({s,i})).sort((a,b)=>at(a.s)-at(b.s)||a.i-b.i).map(x=>x.s)){
  const u=sourceUrl(s.content);if(!u||seen.has(u)||!eligible(u))continue;seen.add(u);urls.push(u);if(urls.length>=max)break;
 }
 return urls;
}

export type RefreshDeps={crawl?:(o:CrawlOptions)=>Promise<CrawlResult>;listSitemap?:typeof listSitemapUrls;fetchOptions?:CrawlOptions['fetchOptions'];delayMs?:number};
export async function refreshWorkspace(client:SupabaseClient,job:{workspace:string;sitemapUrl:string|null},deadline:number,deps:RefreshDeps={}):Promise<{items:number;summary:RefreshSummary}>{
 const src=await client.rpc('service_refresh_sources',{p_ws:job.workspace});
 if(src.error)throw Error('sources unavailable');
 const saved=(Array.isArray(src.data)?src.data:[]) as SavedSource[];
 const savedUrls=saved.map(s=>sourceUrl(s.content)).filter((u):u is string=>!!u);
 /* 'read' means complete; 'partial' means a nested file failed or a cap or the deadline cut the list short.
    A partial list still finds new pages, but absence from it is never treated as a removal. */
 let listed:string[]|null=null,sitemap:RefreshSummary['sitemap']='none';
 const sitemapStart=job.sitemapUrl?normalizeUrl(job.sitemapUrl):null;const sitemapHost=sitemapStart?hostOf(sitemapStart):null;
 if(job.sitemapUrl){try{const r=await (deps.listSitemap??listSitemapUrls)(job.sitemapUrl,{max:500,deadline:Math.min(deadline,Date.now()+15_000),fetchOptions:deps.fetchOptions,delayMs:deps.delayMs});listed=r.urls;sitemap=r.complete?'read':r.urls.length?'partial':'failed';}catch{sitemap='failed';}}
 const sitemapRead=sitemap==='read'||sitemap==='partial';
 const have=new Set(savedUrls);
 const inSitemap=new Set((listed??[]).map(u=>normalizeUrl(u)).filter((u):u is string=>!!u));
 /* New pages (db/052): only sitemap URLs not seen in an earlier read and without a review item. The first
    successful read is the baseline: everything listed is remembered and nothing is proposed as new. */
 const candidates=[...inSitemap].filter(u=>!have.has(u)).slice(0,500);
 let baseline=false,newUrls:string[]=[];
 if(sitemapRead&&candidates.length){
  const un=await client.rpc('service_refresh_unseen',{p_ws:job.workspace,p_urls:candidates});
  if(un.error||!un.data||typeof un.data!=='object')throw Error('sitemap memory unavailable');
  const d=un.data as {baseline?:unknown;unseen?:unknown};
  baseline=d.baseline===true;
  if(!baseline&&Array.isArray(d.unseen))newUrls=d.unseen.filter((u):u is string=>typeof u==='string'&&candidates.includes(u)).slice(0,MAX_NEW);
 }
 // After a complete read, a saved page on the sitemap's host that is not listed is proposed for removal
 // instead of fetched. Saved pages on other hosts, and every page after a partial read, stay eligible, so
 // their removal can only come from a 404/410.
 const recheck=pickRecheck(saved,u=>sitemap!=='read'||!inSitemap.size||hostOf(u)!==sitemapHost||inSitemap.has(u));
 const links=[...recheck,...newUrls];
 const crawl=links.length?await (deps.crawl??crawlSite)({mode:'links',links,maxPages:links.length,deadline,fetchOptions:deps.fetchOptions,delayMs:deps.delayMs}):{pages:[],skipped:[],discovered:0,truncated:false};
 const items=diffRefresh(saved,sitemap==='read'?listed:null,crawl,newUrls,sitemapHost);
 /* What this run actually reached: everything when the crawl finished, otherwise the fetched or skipped URLs. */
 const reached=new Set([...crawl.pages,...crawl.skipped].map(p=>normalizeUrl(p.url)??p.url));
 const attempted=(u:string)=>!crawl.stoppedBy||reached.has(u);
 const checkedUrls=new Set(recheck.filter(attempted));
 const checked=saved.filter(s=>{const u=sourceUrl(s.content);return !!u&&checkedUrls.has(u);}).map(s=>s.id);
 /* Saved pages fetched successfully this run (db/053): a removal the owner dismissed is proposed again only
    after the page has been seen live since the dismissal. */
 const fetched=new Set(crawl.pages.map(p=>normalizeUrl(p.url)??p.url));
 const live=saved.filter(s=>{const u=sourceUrl(s.content);return !!u&&fetched.has(u);}).map(s=>s.id);
 const seen=baseline?candidates:newUrls.filter(attempted);
 const summary:RefreshSummary={checked:recheck.length,changed:items.filter(i=>i.kind==='changed').length,added:items.filter(i=>i.kind==='new').length,removed:items.filter(i=>i.kind==='removed').length,skipped:crawl.skipped.length,sitemap,...(baseline?{sitemapBaseline:true}:{}),...(crawl.stoppedBy?{stoppedBy:crawl.stoppedBy}:{})};
 const rec=await client.rpc('service_refresh_record',{p_ws:job.workspace,p_items:items.map(i=>({kind:i.kind,url:i.url,title:i.title,documentId:i.documentId??null,content:i.content??null})),p_summary:summary,p_checked:checked,p_seen:seen,p_live:live});
 if(rec.error)throw Error('refresh not recorded');
 return{items:Number(rec.data)||0,summary};
}
