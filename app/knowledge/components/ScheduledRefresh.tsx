'use client';
/* Scheduled website refresh: how often saved website pages are re-checked, and the review queue of what
   changed. Applying a change saves it through the normal /api/knowledge path (processing consent, quota and
   embeddings as for any save), then marks it applied. Removed pages are deleted only when the owner says so. */
import {useEffect,useState} from 'react';
import {authHeaders} from '../../../lib/browser-auth';
type Doc={id:string;title:string;published:boolean;updated_at:string};
type Item={id:string;document_id:string|null;url:string;kind:'new'|'changed'|'removed';title:string;content:string|null;detected_at:string;document:Doc|null};
type Settings={frequency:'off'|'monthly'|'weekly'|'daily';sitemap_url:string|null;last_run_at:string|null;next_due_at:string|null;last_summary:{checked?:number;changed?:number;added?:number;removed?:number;sitemap?:string;sitemapBaseline?:boolean}|null};
const KIND={new:'New page',changed:'Changed page',removed:'Removed page'} as const;
export default function ScheduledRefresh({onSaved}:{onSaved:()=>void}){
 const[s,setS]=useState<Settings|null>(null),[items,setItems]=useState<Item[]>([]),[limits,setLimits]=useState(''),[freq,setFreq]=useState<Settings['frequency']>('off'),[sitemap,setSitemap]=useState(''),[consent,setConsent]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function read(){const r=await fetch('/api/knowledge/refresh',{headers:await authHeaders()});const x=await r.json().catch(()=>({}));if(!r.ok||!x.settings){setError(x.error??'Scheduled refresh unavailable.');return;}setError('');setS(x.settings);setItems(x.items??[]);setLimits(x.limits??'');setFreq(x.settings.frequency);setSitemap(x.settings.sitemap_url??'');}
 useEffect(()=>{Promise.resolve().then(read).catch(()=>setError('Scheduled refresh unavailable.'));},[]);
 async function post(url:string,body:unknown){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok||d.error)throw Error(d.error??'Request failed.');return d as {note?:string};}
 async function saveSettings(){setBusy(true);try{const d=await post('/api/knowledge/refresh',{action:'settings',frequency:freq,sitemapUrl:sitemap.trim()||null});setNotice(d.note??'Saved.');await read();}catch(e){setNotice(e instanceof Error?e.message:'Not saved.');}finally{setBusy(false);}}
 async function apply(it:Item){
  if(it.kind!=='removed'&&!consent){setNotice('Confirm processing consent first.');return;}
  setBusy(true);
  try{
   if(it.kind==='removed'){if(!it.document_id)throw Error('Source unavailable.');await post('/api/knowledge',{action:'delete',id:it.document_id});}
   else if(it.kind==='changed'&&it.document){await post('/api/knowledge',{id:it.document.id,expected:it.document.updated_at,input:{title:it.document.title,content:it.content,published:it.document.published,processingConsent:true,sourceKind:'text',applicability:'',effectiveFrom:null,effectiveUntil:null}});}
   else{await post('/api/knowledge',{input:{title:it.title.slice(0,120).padEnd(3,'.'),content:it.content,published:false,processingConsent:true,sourceKind:'text',applicability:'',effectiveFrom:null,effectiveUntil:null}});}
   await post('/api/knowledge/refresh',{action:'resolve',id:it.id,status:'applied'});
   setNotice(it.kind==='removed'?'Source removed.':it.kind==='new'?'New page saved as a private source. Publish it from the list when it is ready.':'Source updated. Its publication setting is unchanged.');
   onSaved();await read();
  }catch(e){setNotice(e instanceof Error?e.message:'Not applied.');}finally{setBusy(false);}
 }
 async function dismiss(it:Item){setBusy(true);try{const d=await post('/api/knowledge/refresh',{action:'resolve',id:it.id,status:'dismissed'});setNotice(d.note??'Dismissed.');await read();}catch(e){setNotice(e instanceof Error?e.message:'Not dismissed.');}finally{setBusy(false);}}
 const sum=s?.last_summary;
 return <section className="ap-dash-card" aria-labelledby="sr-h" id="scheduled-refresh">
  <h2 id="sr-h" className="ap-dash-h2">Scheduled refresh</h2>
  <p className="ap-dash-muted" style={{margin:'6px 0 0'}}>Re-check the website pages you imported, and find new or removed pages from your sitemap. Changes wait here for your review. Nothing is published or overwritten automatically.</p>
  {error&&<p role="alert" className="ap-dash-muted" style={{marginTop:8}}>{error}</p>}
  {s&&<>
   <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-end',marginTop:10}}>
    <label className="ap-dash-field">How often<select className="ap-dash-select" value={freq} onChange={e=>setFreq(e.target.value as Settings['frequency'])}><option value="off">Off</option><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></select></label>
    <label className="ap-dash-field" style={{flex:'1 1 260px'}}>Sitemap URL (optional, finds new and removed pages)<input className="ap-dash-select" type="url" inputMode="url" maxLength={500} value={sitemap} onChange={e=>setSitemap(e.target.value)} placeholder="https://example.com/sitemap.xml"/></label>
    <button type="button" className="ap-dash-btn" disabled={busy} onClick={()=>void saveSettings()} style={{minHeight:44}}>Save schedule</button>
   </div>
   <p className="ap-dash-muted" style={{marginTop:8}}>{s.last_run_at?`Last run ${new Date(s.last_run_at).toISOString().slice(0,16).replace('T',' ')} UTC: ${sum?.checked??0} checked, ${sum?.changed??0} changed, ${sum?.added??0} new, ${sum?.removed??0} removed${sum?.sitemap==='failed'?'; the sitemap could not be read':sum?.sitemap==='partial'?'; the sitemap was only partly read, so no page was proposed for removal from it':''}${sum?.sitemapBaseline?'; this first sitemap read is the starting point, so later runs report only pages added after it':''}.`:'Not run yet.'}{s.next_due_at&&s.frequency!=='off'?` Next check after ${new Date(s.next_due_at).toISOString().slice(0,16).replace('T',' ')} UTC.`:''} {limits}</p>
   <p role="status" className="ap-dash-muted" style={{marginTop:6,wordBreak:'break-word'}}>{notice}</p>
   <h3 className="ap-dash-h2" style={{fontSize:14,marginTop:12}}>Waiting for review ({items.length})</h3>
   {!items.length?<p className="ap-dash-muted">No changes waiting.</p>:<>
    <label style={{display:'flex',gap:8,alignItems:'flex-start',margin:'8px 0',fontSize:12.5}}><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I consent to processing the new text of the pages I apply (sent for embeddings, as with any saved source).</label>
    <ul aria-label="Refresh changes" style={{listStyle:'none',margin:0,padding:0}}>{items.map(it=><li key={it.id} className="ap-dash-row" style={{flexDirection:'row',flexWrap:'wrap',gap:10,alignItems:'center'}}>
     <div style={{flex:'1 1 240px',minWidth:0}}><p style={{margin:0,fontWeight:650,overflowWrap:'anywhere'}}><span className="ap-dash-badge ap-dash-b-info">{KIND[it.kind]}</span> {it.document?.title??it.title}</p>
      <p className="ap-dash-muted" style={{margin:'2px 0 0',fontSize:11.5,overflowWrap:'anywhere'}}>{it.url} · found {new Date(it.detected_at).toISOString().slice(0,10)}{it.content?` · ${it.content.length} characters`:''}</p>
      {it.content&&<details><summary className="ap-dash-muted" style={{fontSize:12}}>Preview new text</summary><p style={{whiteSpace:'pre-wrap',fontSize:12,maxHeight:200,overflow:'auto',overflowWrap:'anywhere'}}>{it.content.slice(0,2000)}</p></details>}</div>
     <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
      <button type="button" className="ap-dash-btn" disabled={busy||(it.kind!=='removed'&&!consent)} onClick={()=>void apply(it)} style={{minHeight:44}}>{it.kind==='removed'?'Remove source':it.kind==='new'?'Save as private source':'Update source'}</button>
      <button type="button" className="ap-dash-btn ap-dash-btn-ghost" disabled={busy} onClick={()=>void dismiss(it)} style={{minHeight:44}}>Dismiss</button>
     </div>
    </li>)}</ul></>}
  </>}
 </section>;
}
