'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import DeskShell from '../components/DeskShell';
import DashShell,{DIcon} from '../components/DashShell';
import {authHeaders} from '../../lib/browser-auth';
import {downloadCsv} from '../../lib/exports';
import {filterLeads,leadsCsv,type Lead} from '../../lib/leads';
/* Leads: consented contact emails visitors left in the widget. Manager role and up (the API returns 403 for
   agents). Search is a plain substring match; export writes a formula-safe CSV of the leads shown. Deleting a
   lead removes the address and consent; the request stays in Tickets. Nothing is forwarded anywhere. */
type Data={leads:Lead[];total:number;limit:number;coverage:string;demo?:boolean};
const when=(s:string)=>new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export default function Leads(){
 const[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState<string|null>(null);
 const load=useCallback(async()=>{const r=await fetch('/api/leads',{headers:await authHeaders()});const d=await r.json();if(!r.ok||d.error){setError(d.error??'Could not load leads.');setData(null);}else{setError('');setData(d);}},[]);
 useEffect(()=>{load().catch(()=>setError('Could not load leads.'));},[load]);
 async function remove(id:string){setBusy(true);try{const r=await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({action:'delete',id})});const d=await r.json();setNotice(d.note??d.error);setConfirm(null);if(r.ok)await load();}catch{setNotice('Request failed.');}finally{setBusy(false);}}
 const shown=data?filterLeads(data.leads,query):[];
 function exportCsv(){downloadCsv(`automatepal-leads-${new Date().toISOString().slice(0,10)}.csv`,leadsCsv(shown));setNotice(`Exported ${shown.length} lead${shown.length===1?'':'s'} as CSV. Nothing was sent anywhere.`);}
 return <DeskShell><DashShell crumb="Leads"><main style={{display:'contents'}}>
<header>
<p className="ap-dash-kicker">Customer support / leads</p>
<h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Leads</span></span></h1>
<p className="ap-dash-sub">Contact emails that visitors chose to share with you in the widget, with their consent. Search, export or delete them here. Nothing is forwarded to email or a CRM.</p>
</header>
{error&&<section className="ap-dash-card" role="alert"><p className="ap-dash-muted" style={{margin:0}}>{error}</p></section>}
{data&&<section className="ap-dash-card" aria-labelledby="leads-h">
<div style={{display:'flex',flexWrap:'wrap',alignItems:'flex-end',justifyContent:'space-between',gap:12}}>
<h2 id="leads-h" className="ap-dash-h2">Consented emails <span className="ap-dash-chip">{data.total}{data.total>=data.limit?'+':''}</span></h2>
<div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'flex-end'}}>
<label className="ap-dash-field">Search leads<input type="search" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} placeholder="Email or request kind" className="ap-dash-select"/></label>
<button type="button" disabled={!shown.length} onClick={exportCsv} className="ap-dash-btn ap-dash-btn-ghost"><DIcon name="audit" size={13}/>Export CSV</button>
</div></div>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>{data.coverage} CSV cells that start with = + - @ are escaped so spreadsheets treat them as text.</p>
<p role="status" className="ap-dash-muted" style={{margin:'8px 0 0',wordBreak:'break-word'}}>{notice}</p>
{!data.leads.length&&<p className="ap-dash-muted" style={{marginTop:12,border:'1.5px dashed #DDE3F0',borderRadius:14,padding:24,textAlign:'center'}}>No leads yet. When a visitor leaves an email with consent in the widget, it appears here.</p>}
{!!data.leads.length&&!shown.length&&<p className="ap-dash-muted" style={{marginTop:12}}>No leads match “{query}”.</p>}
<ul aria-label="Leads" style={{listStyle:'none',margin:'10px 0 0',padding:0}}>{shown.map(l=><li key={l.id} className="ap-dash-row" style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10}}>
<div style={{flex:'1 1 220px',minWidth:0}}><p style={{margin:0,fontWeight:650,color:'#0A1B3D',wordBreak:'break-all'}}>{l.contact_email}</p>
<p className="ap-dash-muted" style={{margin:'2px 0 0',fontSize:11.5}}>{l.kind.replaceAll('_',' ')} · {when(l.created_at)}{l.case_id?<> · <Link href="/tickets">conversation {l.case_id.slice(0,8)}</Link></>:null}</p></div>
{!data.demo&&(confirm===l.id?<div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button type="button" disabled={busy} onClick={()=>remove(l.id)} className="ap-dash-btn" style={{padding:'7px 12px',fontSize:11.5}}>Confirm delete</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)} className="ap-dash-btn ap-dash-btn-ghost" style={{padding:'7px 12px',fontSize:11.5}}>Cancel</button></div>
:<button type="button" disabled={busy} onClick={()=>{setConfirm(l.id);setNotice('');}} className="ap-dash-btn ap-dash-btn-ghost" aria-label={'Delete lead '+l.contact_email} style={{padding:'7px 12px',fontSize:11.5}}>Delete</button>)}
</li>)}</ul>
{data.demo&&<p className="ap-dash-muted" style={{margin:'10px 0 0'}}>Demo preview: sign in to delete leads.</p>}
<p className="ap-dash-muted" style={{margin:'12px 0 0'}}>Deleting a lead removes the email address and the consent from that request. The request itself stays in Tickets.</p>
</section>}
</main></DashShell></DeskShell>;
}
