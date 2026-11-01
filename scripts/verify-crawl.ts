// Website crawl checks against a local HTTP server. No outside network: a fake resolver maps test hostnames,
// 127.0.0.1 stands in for a public address, and 10.x answers are private.
import assert from'node:assert/strict';
import{createServer}from'node:http';
import{crawlSite,parseLinkList,normalizeUrl,pathAllowed,parseSitemap,robotsSitemaps,htmlToMarkdown,looksJsRendered,MAX_PAGES}from'../lib/crawl';
import{contextDevRenderer}from'../lib/context-dev';
import{resolvedAddrsProblem,type Addr}from'../lib/url-import';
function ok(n:string){console.log('PASS',n);}
const LOCAL='127.0.0.1';
const body=(t:string)=>`<p>${t} `+'This paragraph has enough words to count as real page content for the crawler. '.repeat(4)+'</p>';
const page=(title:string,main:string,links:string[]=[])=>`<!doctype html><html><head><title>${title}</title><style>.x{}</style><script>var secret=1</script></head><body>
<nav><a href="/">Home</a> <a href="/pricing">Pricing</a> NAVIGATION MENU TEXT</nav>
<header>SITE HEADER</header><main><article><h1>${title}</h1>${main}${links.map(l=>`<a href="${l}">${l}</a>`).join(' ')}</article></main>
<footer>FOOTER TEXT copyright</footer><div class="cookie">COOKIE BANNER</div></body></html>`;
let port=0;
const hits:string[]=[];
const server=createServer((req,res)=>{
 const host=(req.headers.host??'').split(':')[0];const u=new URL(req.url??'/','http://x');const path=u.pathname;hits.push(host+path+u.search);
 const html=(s:string,code=200)=>{res.writeHead(code,{'content-type':'text/html; charset=utf-8'});res.end(s);};
 const xml=(s:string)=>{res.writeHead(200,{'content-type':'application/xml'});res.end(s);};
 if(path==='/robots.txt'){res.writeHead(200,{'content-type':'text/plain'});res.end(`User-agent: *\nDisallow: /private\nSitemap: http://shop.test:${port}/sitemap_index.xml`);return;}
 if(path==='/sitemap_index.xml')return xml(`<sitemapindex><sitemap><loc>http://shop.test:${port}/sitemap-pages.xml</loc></sitemap><sitemap><loc>http://shop.test:${port}/sitemap-blog.xml</loc></sitemap></sitemapindex>`);
 if(path==='/sitemap-pages.xml')return xml(`<urlset><url><loc>http://shop.test:${port}/</loc></url><url><loc>http://shop.test:${port}/pricing?utm_source=x</loc></url><url><loc>http://other.test:${port}/elsewhere</loc></url><url><loc>http://shop.test:${port}/private/admin</loc></url></urlset>`);
 if(path==='/sitemap-blog.xml')return xml(`<urlset><url><loc>http://shop.test:${port}/blog/one</loc></url><url><loc>http://shop.test:${port}/blog/two</loc></url></urlset>`);
 if(path==='/')return html(page('Home',body('Welcome to the shop.'),['/pricing','/blog/one','/about#team','/logo.png','mailto:a@b.c','http://partner.test:'+port+'/partner','/to-private','/js-app']));
 if(path==='/pricing')return html(page('Pricing',body('Plans start at 12 dollars.'),['/blog/two']));
 if(path==='/about')return html(page('About',body('We are a small team.'),['/deep/1']));
 if(path==='/deep/1')return html(page('Deep 1',body('Level two page.'),['/deep/2']));
 if(path==='/deep/2')return html(page('Deep 2',body('Level three page.'),['/deep/3']));
 if(path==='/deep/3')return html(page('Deep 3',body('Level four page.')));
 if(path==='/blog/one')return html(page('Blog one',body('First post about shipping.')));
 if(path==='/blog/two')return html(page('Blog one',body('First post about shipping.')));            // same page served at a second address
 if(path==='/partner')return html(page('Partner',body('Partner page.'),['/partner-deeper']));
 if(path==='/private/admin')return html(page('Admin',body('Should never be fetched.')));
 if(path==='/to-private'){res.writeHead(302,{location:'http://intranet.test/secret'});res.end();return;}
 if(path==='/short')return html('<html><head><title>Short</title></head><body><main><h1>Short page</h1><p>Opening hours are 9 to 5 on weekdays, closed on public holidays.</p></main></body></html>');
 if(path==='/js-app')return html('<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 html('<p>not found</p>',404);
});
const resolve=async(h:string):Promise<Addr[]>=>{if(['shop.test','other.test','partner.test'].includes(h))return[{address:LOCAL,family:4}];if(h==='intranet.test')return[{address:'10.1.2.3',family:4}];throw new Error('NXDOMAIN');};
const addrProblem=(a:Addr[])=>a.every(x=>x.address===LOCAL)?null:resolvedAddrsProblem(a.filter(x=>x.address!==LOCAL));
const fetchOptions={resolve,addrProblem};
const base=()=>`http://shop.test:${port}`;

async function main(){
 // ---- Pure helpers ----
 assert.equal(normalizeUrl('https://Example.com/a/?utm_source=x&b=2&a=1#top'),'https://example.com/a?a=1&b=2');
 assert.equal(normalizeUrl('ftp://x.com/'),null);
 const l=parseLinkList('"https://a.com/x", <https://a.com/y>; www.b.com/page\nhttps://a.com/x\nPage title here');
 assert.deepEqual(l.links,['https://a.com/x','https://a.com/y','https://www.b.com/page']);
 assert.ok(l.notLinks.includes('Page')&&l.notLinks.includes('title'));
 assert.equal(pathAllowed('https://a.com/blog/x',['/blog']),true);
 assert.equal(pathAllowed('https://a.com/docs/x',['/blog']),false);
 assert.equal(pathAllowed('https://a.com/blog/draft',['/blog'],['draft']),false,'exclude wins over include');
 const sm=parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex><urlset><url><loc>https://a.com/?a=1&amp;b=2</loc></url></urlset>');
 assert.deepEqual(sm.sitemaps,['https://a.com/s1.xml']);assert.deepEqual(sm.pages,['https://a.com/?a=1&b=2']);
 assert.deepEqual(robotsSitemaps('User-agent: *\nSitemap: https://a.com/sitemap.xml\nsitemap: https://a.com/s2.xml'),['https://a.com/sitemap.xml','https://a.com/s2.xml']);
 ok('helpers: URL normalisation, SiteGPT-style link list repair, include/exclude, sitemap and robots parsing');

 const ex=htmlToMarkdown(page('Pricing',body('Plans start at 12 dollars.')),'https://a.com/pricing');
 assert.ok(ex.markdown.includes('Plans start at 12 dollars.'));
 for(const junk of['NAVIGATION MENU TEXT','SITE HEADER','FOOTER TEXT','COOKIE BANNER','var secret'])assert.ok(!ex.markdown.includes(junk),'stripped: '+junk);
 assert.ok(/^# Pricing/m.test(ex.markdown),'headings kept as Markdown');
 const sel=htmlToMarkdown('<body><div class="keep">'+body('Kept part.')+'</div><div class="drop">Dropped part.</div></body>','https://a.com',{includeSelectors:['.keep']});
 assert.ok(sel.markdown.includes('Kept part.')&&!sel.markdown.includes('Dropped part.'));
 const rm=htmlToMarkdown('<body><main>'+body('Body text.')+'<div class="promo">PROMO</div></main></body>','https://a.com',{mainContentOnly:false,excludeSelectors:['.promo']});
 assert.ok(rm.markdown.includes('Body text.')&&!rm.markdown.includes('PROMO'));
 ok('extraction: main content only (nav, header, footer, cookie banner, scripts removed), CSS selectors to keep and remove');

 await new Promise<void>(r=>server.listen(0,LOCAL,r));port=(server.address() as {port:number}).port;
 try{
  // ---- Sitemap mode ----
  hits.length=0;
  const s=await crawlSite({mode:'sitemap',url:base()+'/sitemap_index.xml',maxPages:20,fetchOptions,delayMs:0});
  const urls=s.pages.map(p=>new URL(p.url).pathname).sort();
  assert.deepEqual(urls,['/','/blog/one','/pricing'],'nested sitemaps followed; duplicate content dropped once');
  assert.ok(s.pages.find(p=>p.url.endsWith('/pricing'))!.url.indexOf('utm_')<0,'tracking parameters stripped');
  assert.ok(!hits.some(h=>h.startsWith('other.test')),'other hostname in the sitemap not fetched');
  assert.ok(!hits.some(h=>h.includes('/private/admin')),'robots.txt disallowed page never requested');
  assert.ok(s.skipped.some(x=>/robots\.txt/.test(x.reason)));
  assert.ok(s.skipped.some(x=>/Duplicate content/.test(x.reason)));
  assert.ok(s.pages.every(p=>p.pageUnits>=1&&p.chars===p.markdown.length&&p.via==='html'));
  ok('sitemap: sitemap index followed, same hostname only, robots.txt honoured, duplicates and tracking URLs removed');
  const blogOnly=await crawlSite({mode:'sitemap',url:base()+'/sitemap_index.xml',maxPages:1,includePaths:['/blog'],fetchOptions,delayMs:0});
  assert.deepEqual(blogOnly.pages.map(p=>new URL(p.url).pathname),['/blog/one'],'include paths applied to the whole sitemap before the page cap');
  ok('sitemap: filters run before the page cap, so pages listed late are still found');

  // ---- Site mode: depth, allowed domains, private redirect, JS page ----
  hits.length=0;
  const d1=await crawlSite({mode:'site',url:base()+'/',depth:1,maxPages:20,fetchOptions,delayMs:0});
  const d1p=d1.pages.map(p=>new URL(p.url).pathname);
  assert.ok(d1p.includes('/')&&d1p.includes('/pricing')&&d1p.includes('/about'),'depth 1 reaches linked pages');
  assert.ok(!d1p.includes('/deep/1'),'depth 1 stops before level 2');
  assert.ok(!hits.some(h=>h.startsWith('partner.test')),'other domains not fetched unless allowed');
  assert.ok(!hits.some(h=>h.includes('/logo.png')),'image links not fetched');
  assert.ok(!hits.some(h=>h.startsWith('intranet.test')),'redirect to a private address never requested');
  // The redirect target is refused by name (".test" counts as a private host) before any DNS lookup or request.
  assert.ok(d1.skipped.some(x=>x.url.endsWith('/to-private')&&/redirected to (?:a private network address|an address that cannot be imported)/.test(x.reason)));
  assert.ok(d1.skipped.some(x=>x.url.endsWith('/js-app')&&/needs a browser/.test(x.reason)),'JS-only page reported, not imported');
  ok('site: depth limit, same host only, files and mailto skipped, private redirect refused, JS-only page flagged');

  hits.length=0;
  const d3=await crawlSite({mode:'site',url:base()+'/',depth:3,maxPages:20,allowedDomains:['partner.test:'+port,'partner.test'],fetchOptions,delayMs:0});
  const d3p=d3.pages.map(p=>new URL(p.url).host+new URL(p.url).pathname);
  assert.ok(d3p.some(x=>x.endsWith('/deep/2'))&&!d3p.some(x=>x.endsWith('/deep/3')),'depth 3 reaches level 3 only');
  assert.ok(d3p.some(x=>x.startsWith('partner.test')),'allowed domain page added');
  assert.ok(!hits.some(h=>h.includes('/partner-deeper')),'allowed domain pages are not followed');
  ok('site: deeper crawl and allowed domains (added, not followed), like SiteGPT');

  const cap=await crawlSite({mode:'site',url:base()+'/',depth:5,maxPages:2,fetchOptions,delayMs:0});
  assert.equal(cap.pages.length,2);assert.equal(cap.truncated,true);assert.equal(cap.stoppedBy,'page limit');
  const big=await crawlSite({mode:'site',url:base()+'/',depth:1,maxPages:9999,fetchOptions,delayMs:0});
  assert.ok(big.pages.length<=MAX_PAGES);
  const inc=await crawlSite({mode:'site',url:base()+'/',depth:2,maxPages:20,includePaths:['/blog'],fetchOptions,delayMs:0});
  assert.ok(inc.pages.every(p=>new URL(p.url).pathname.startsWith('/blog')),'include paths filter pages');
  const skip=await crawlSite({mode:'links',links:[base()+'/pricing',base()+'/about'],skipUrls:[base()+'/pricing'],fetchOptions,delayMs:0});
  assert.deepEqual(skip.pages.map(p=>new URL(p.url).pathname),['/about'],'already imported pages skipped');
  ok('limits: page cap with truncation flag, hard maximum, include paths, skip already-imported pages');

  // ---- Browser rendering fallback ----
  let calls=0;
  const fb=await crawlSite({mode:'links',links:[base()+'/js-app',base()+'/pricing'],fetchOptions,delayMs:0,renderFallback:async()=>{calls++;return{title:'Rendered app',markdown:'# Rendered app\n\n'+'Content that only appears after JavaScript runs. '.repeat(8)};}});
  assert.equal(calls,1,'fallback used only for the page with too little text');
  const r=fb.pages.find(p=>p.url.endsWith('/js-app'))!;assert.equal(r.via,'render');assert.equal(r.title,'Rendered app');
  ok('fallback: browser rendering used only where plain HTML gave too little text');
  assert.equal(looksJsRendered('<html><body><div id="root"></div><script src="/a.js"></script></body></html>'),true);
  assert.equal(looksJsRendered('<html><body><h1>Example Domain</h1><p>'+'Static text here. '.repeat(15)+'</p></body></html>'),false,'static page, no scripts');
  assert.equal(looksJsRendered('<html><body><noscript>You need to enable JavaScript to run this app.</noscript><script></script>'+'<p>x</p>'.repeat(5)+'</body></html>'),true);
  let paid=0;
  const shortStatic=await crawlSite({mode:'links',links:[base()+'/short'],fetchOptions,delayMs:0,renderFallback:async()=>{paid++;return null;}});
  assert.equal(paid,0,'a short static page is not sent to paid rendering');
  assert.equal(shortStatic.pages.length,1,'a short static page with real text is kept');
  ok('fallback: only JavaScript app shells use paid rendering; short static pages keep their own text');

  // ---- Politeness delay ----
  const t0=Date.now();await crawlSite({mode:'links',links:[base()+'/pricing',base()+'/about'],fetchOptions,delayMs:300});
  assert.ok(Date.now()-t0>=600,'one delay per request to the same host (robots + 2 pages)');
  ok('politeness: delay between requests to the same host');

  // ---- Context.dev client (fake fetch, no network, no credits) ----
  const saved=process.env.CONTEXT_DEV_API_KEY;process.env.CONTEXT_DEV_API_KEY='ctxt_test_fake';
  const seen:string[]=[];
  const fake=(async(u:string,init?:{headers?:Record<string,string>})=>{seen.push(u+' '+(init?.headers?.Authorization??''));return new Response(JSON.stringify({success:true,markdown:'# Hi\n\nRendered text.',metadata:{title:'Hi'}}),{status:200});}) as unknown as typeof fetch;
  const rr=contextDevRenderer(2,fake)!;
  assert.deepEqual(await rr('https://example.com/app'),{markdown:'# Hi\n\nRendered text.',title:'Hi'});
  assert.equal(await rr('http://localhost/x'),null,'private URL: no credits spent');
  await rr('https://example.com/b');assert.equal(await rr('https://example.com/c'),null,'per-crawl render limit');
  assert.equal(seen.length,2);assert.ok(seen[0].startsWith('https://api.context.dev/v1/web/scrape/markdown?url=https%3A%2F%2Fexample.com%2Fapp'));assert.ok(seen[0].endsWith('Bearer ctxt_test_fake'));
  delete process.env.CONTEXT_DEV_API_KEY;assert.equal(contextDevRenderer(),null,'no key: no renderer');
  if(saved!==undefined)process.env.CONTEXT_DEV_API_KEY=saved;
  ok('Context.dev: bounded calls, public URLs only, bearer auth, disabled without a key');
 }finally{server.close();}
 console.log('all crawl checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
