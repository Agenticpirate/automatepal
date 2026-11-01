'use client';
import{useEffect,useState}from'react';
import{authHeaders}from'../../../lib/browser-auth';
import'./website-import.css';

/* Website import: crawl a site, a sitemap or a list of links, review the extracted pages, then save the ones
   you pick as knowledge sources. Saving reuses the existing consent-checked POST /api/knowledge path, one
   source per page, so publication and processing consent work exactly as for a pasted source. */
type Page={url:string;title:string;markdown:string;chars:number;pageUnits:number;via:'html'|'render'};
type Skip={url:string;reason:string};
type Result={pages:Page[];skipped:Skip[];discovered:number;truncated:boolean;stoppedBy?:string;browserRenders:number;notLinks:string[];note:string};
type Mode='site'|'sitemap'|'links';
type Row={page:Page;pick:boolean;state:'ready'|'saving'|'saved'|'failed';msg?:string};
const lines=(s:string)=>s.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,20);

export default function WebsiteImport({onSaved,sourcesLeft,existingTitles}:{onSaved:()=>void;sourcesLeft:number;existingTitles:string[]}){
 const[mode,setMode]=useState<Mode>('site');
 const[url,setUrl]=useState('');
 const[links,setLinks]=useState('');
 const[depth,setDepth]=useState(2);
 const[maxPages,setMaxPages]=useState(10);
 const[include,setInclude]=useState('');
 const[exclude,setExclude]=useState('');
 const[allowed,setAllowed]=useState('');
 const[keepSel,setKeepSel]=useState('');
 const[dropSel,setDropSel]=useState('');
 const[mainOnly,setMainOnly]=useState(true);
 const[render,setRender]=useState(false);
 const[canRender,setCanRender]=useState(false);
 const[busy,setBusy]=useState(false);
 const[notice,setNotice]=useState('');
 const[result,setResult]=useState<Result|null>(null);
 const[rows,setRows]=useState<Row[]>([]);
 const[consent,setConsent]=useState(false);
 const[publish,setPublish]=useState(false);
 const[open,setOpen]=useState<string|null>(null);
 useEffect(()=>{let on=true;void(async()=>{try{const r=await fetch('/api/knowledge/crawl',{headers:await authHeaders()});if(r.ok){const d=await r.json();if(on)setCanRender(!!d.browserRendering);}}catch{/* status only */}})();return()=>{on=false};},[]);

 async function crawl(){
  setBusy(true);setNotice(mode==='links'?'Fetching your links…':'Crawling. This can take up to a minute for larger sites…');setResult(null);setRows([]);
  try{
   const r=await fetch('/api/knowledge/crawl',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({mode,url:mode==='links'?undefined:url.trim(),links:mode==='links'?links:undefined,depth,maxPages,includePaths:lines(include),excludePaths:lines(exclude),allowedDomains:lines(allowed),includeSelectors:lines(keepSel),excludeSelectors:lines(dropSel),mainContentOnly:mainOnly,useBrowserRendering:render&&canRender})});
   const d=await r.json();
   if(!r.ok){setNotice(d.error??'The import failed.');return;}
   setResult(d);
   // Pre-select pages that fit in the remaining source quota and are not already saved under the same title.
   let room=sourcesLeft;
   setRows((d.pages as Page[]).map(p=>{const dup=existingTitles.includes(p.title.slice(0,120));const pick=!dup&&room>0;if(pick)room--;return{page:p,pick,state:'ready' as const,msg:dup?'A source with this title already exists.':undefined};}));
   setNotice(d.pages.length?`${d.pages.length} ${d.pages.length===1?'page':'pages'} ready for review. ${d.note}`:'No pages with readable text were found. Check the skipped list below.');
  }catch{setNotice('Could not reach the import service. Try again.');}
  finally{setBusy(false);}
 }

 async function save(){
  const picked=rows.filter(r=>r.pick&&r.state!=='saved');
  if(!picked.length||!consent)return;
  setBusy(true);let saved=0,failed=0;
  for(const row of picked){
   setRows(rs=>rs.map(r=>r===row?{...r,state:'saving'}:r));
   try{
    const content=('Source: '+row.page.url+'\n\n'+row.page.markdown).slice(0,30000);
    const res=await fetch('/api/knowledge',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({input:{title:row.page.title.slice(0,120).padEnd(3,'.'),content,published:publish,processingConsent:true,sourceKind:'text',applicability:'',effectiveFrom:null,effectiveUntil:null}})});
    const d=await res.json().catch(()=>({}));
    if(!res.ok||d.error)throw Error(d.error??'Save failed.');
    saved++;setRows(rs=>rs.map(r=>r.page.url===row.page.url?{...r,state:'saved',msg:undefined}:r));
   }catch(e){failed++;setRows(rs=>rs.map(r=>r.page.url===row.page.url?{...r,state:'failed',msg:e instanceof Error?e.message:'Save failed.'}:r));}
  }
  setBusy(false);
  setNotice(`${saved} ${saved===1?'page':'pages'} saved${publish?' and published':' as private sources'}.${failed?` ${failed} failed; see the list.`:''}`);
  if(saved)onSaved();
 }

 const picked=rows.filter(r=>r.pick&&r.state!=='saved');
 const units=picked.reduce((n,r)=>n+r.page.pageUnits,0);
 const canCrawl=!busy&&(mode==='links'?links.trim().length>8:url.trim().length>10);
 return <section className="ap-dash-card wi" aria-labelledby="wi-title">
  <h2 id="wi-title" className="ap-dash-h2">Import from your website</h2>
  <p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Crawl a site, a sitemap or a list of links. Pages are fetched, cleaned to their main text and shown here for review. Nothing is saved until you pick pages below. robots.txt is respected and private addresses are refused.</p>
  <div className="wi-modes" role="tablist" aria-label="Import method">
   {([['site','Crawl a website'],['sitemap','Use a sitemap'],['links','List of links']] as const).map(([m,l])=><button key={m} type="button" role="tab" aria-selected={mode===m} onClick={()=>setMode(m)}>{l}</button>)}
  </div>
  {mode==='links'
   ?<label className="ap-dash-field">Links, one per line<textarea value={links} onChange={e=>setLinks(e.target.value)} rows={4} maxLength={20000} placeholder={'https://example.com/pricing\nhttps://example.com/faq'} className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
   :<label className="ap-dash-field">{mode==='site'?'Website URL to start from':'Sitemap URL'}<input type="url" value={url} onChange={e=>setUrl(e.target.value)} maxLength={500} placeholder={mode==='site'?'https://example.com':'https://example.com/sitemap.xml'} className="ap-dash-select"/></label>}
  <div className="wi-grid">
   {mode==='site'&&<label className="ap-dash-field">Link depth<select value={depth} onChange={e=>setDepth(Number(e.target.value))} className="ap-dash-select">{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}{n===1?' (start page and its links)':''}</option>)}</select></label>}
   <label className="ap-dash-field">Most pages<select value={maxPages} onChange={e=>setMaxPages(Number(e.target.value))} className="ap-dash-select">{[5,10,20,30,50].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
  </div>
  <details className="wi-more"><summary>Filters and options</summary>
   <div className="wi-grid">
    {mode!=='links'&&<label className="ap-dash-field">Only URLs containing (one per line)<textarea value={include} onChange={e=>setInclude(e.target.value)} rows={2} placeholder="/help" className="ap-dash-select"/></label>}
    {mode!=='links'&&<label className="ap-dash-field">Skip URLs containing (one per line)<textarea value={exclude} onChange={e=>setExclude(e.target.value)} rows={2} placeholder="/blog/tag" className="ap-dash-select"/></label>}
    {mode==='site'&&<label className="ap-dash-field">Also add pages on (hostnames)<textarea value={allowed} onChange={e=>setAllowed(e.target.value)} rows={2} placeholder="docs.example.com" className="ap-dash-select"/></label>}
    <label className="ap-dash-field">Keep only these parts (CSS selectors)<textarea value={keepSel} onChange={e=>setKeepSel(e.target.value)} rows={2} placeholder="main" className="ap-dash-select"/></label>
    <label className="ap-dash-field">Remove these parts (CSS selectors)<textarea value={dropSel} onChange={e=>setDropSel(e.target.value)} rows={2} placeholder=".newsletter" className="ap-dash-select"/></label>
   </div>
   <label className="ap-dash-checkrow"><input type="checkbox" checked={mainOnly} onChange={e=>setMainOnly(e.target.checked)}/>Extract main content only (leave out menus, headers and footers)</label>
   <label className="ap-dash-checkrow" style={{marginTop:8}}><input type="checkbox" checked={render&&canRender} disabled={!canRender} onChange={e=>setRender(e.target.checked)}/>{canRender?'Use browser rendering for pages built with JavaScript (Context.dev, up to 10 pages per import)':'Browser rendering for JavaScript sites is available to signed-in owners when Context.dev is connected'}</label>
  </details>
  <div className="wi-actions"><button type="button" className="ap-dash-btn" disabled={!canCrawl} onClick={crawl}>{busy&&!rows.length?'Fetching…':mode==='site'?'Crawl and review':'Fetch and review'}</button></div>
  {notice&&<p className="ap-dash-muted wi-notice" role="status" aria-live="polite">{notice}</p>}
  {result&&rows.length>0&&<div className="wi-review">
   <div className="wi-review-head"><b>{rows.length} {rows.length===1?'page':'pages'} found</b><span>{result.discovered} discovered{result.truncated?` · stopped at your limit (${result.stoppedBy})`:result.stoppedBy?` · stopped: ${result.stoppedBy}`:''}{result.browserRenders?` · ${result.browserRenders} rendered in a browser`:''}</span>
    <button type="button" className="ap-dash-ticket-id" onClick={()=>setRows(rs=>rs.map(r=>r.state==='saved'?r:{...r,pick:!rs.every(x=>x.pick||x.state==='saved')}))}>{rows.every(r=>r.pick||r.state==='saved')?'Clear all':'Select all'}</button></div>
   <ul className="wi-list">{rows.map(r=><li key={r.page.url} data-state={r.state}>
    <label className="ap-dash-checkrow"><input type="checkbox" checked={r.pick||r.state==='saved'} disabled={r.state==='saved'||busy} onChange={e=>setRows(rs=>rs.map(x=>x===r?{...x,pick:e.target.checked}:x))}/><span className="wi-title">{r.page.title}</span></label>
    <div className="wi-meta"><span className="wi-url">{r.page.url}</span><span>{r.page.pageUnits} {r.page.pageUnits===1?'page unit':'page units'}{r.page.via==='render'?' · browser rendered':''}</span>
     <span className="wi-state" data-state={r.state}>{r.state==='saved'?'Saved':r.state==='saving'?'Saving…':r.state==='failed'?'Failed':''}</span></div>
    {r.msg&&<p className="wi-msg">{r.msg}</p>}
    <button type="button" className="ap-dash-ticket-id" aria-expanded={open===r.page.url} onClick={()=>setOpen(o=>o===r.page.url?null:r.page.url)}>{open===r.page.url?'Hide text':'Preview text'}</button>
    {open===r.page.url&&<pre className="wi-preview">{r.page.markdown.slice(0,4000)}{r.page.markdown.length>4000?'\n…':''}</pre>}
   </li>)}</ul>
   <div className="wi-save">
    <p className="ap-dash-muted" style={{margin:0}}>{picked.length} selected · {units} page units · {sourcesLeft} {sourcesLeft===1?'source':'sources'} left in your quota{picked.length>sourcesLeft?' - deselect some pages to fit':''}</p>
    <label className="ap-dash-checkrow"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I allow this text to be sent to the AI provider for embedding and answers. I have permission to use it and it contains no secrets or personal customer data.</label>
    <label className="ap-dash-checkrow"><input type="checkbox" checked={publish} onChange={e=>setPublish(e.target.checked)}/>Publish these pages to anyone with a valid demo link (otherwise they stay private)</label>
    <button type="button" className="ap-dash-btn" disabled={busy||!consent||!picked.length||picked.length>sourcesLeft} onClick={save}>{busy&&rows.some(r=>r.state==='saving')?'Saving…':`Save ${picked.length} ${picked.length===1?'page':'pages'}`}</button>
   </div>
  </div>}
  {result&&(result.skipped.length>0||result.notLinks.length>0)&&<details className="wi-skipped"><summary>{result.skipped.length} skipped{result.notLinks.length?` · ${result.notLinks.length} lines were not links`:''}</summary>
   <ul>{result.skipped.slice(0,100).map(s=><li key={s.url+s.reason}><span className="wi-url">{s.url}</span><span>{s.reason}</span></li>)}{result.notLinks.map(t=><li key={'n'+t}><span className="wi-url">{t}</span><span>Not a link</span></li>)}</ul>
  </details>}
 </section>;
}
