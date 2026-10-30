"use client";
import DeskShell from '../components/DeskShell';
import DashShell,{DashNotif,DIcon} from '../components/DashShell';
import {useEffect,useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
type Request={id:string;created_at:string;kind:string;message:string;status:string;contact_email?:string;contact_consent?:boolean};
type InboxCase={id:string;order_label:string;inbox_state:'open'|'attention'|'taken_over'|'closed';expires_at:string};
function buildNotifs(requests:Request[],cases:InboxCase[]):DashNotif[]{const out:DashNotif[]=[];
for(const r of requests){if(r.status==='pending_review')out.push({id:'r-'+r.id,kind:'info',title:r.kind==='refund_request'?'Refund review pending':r.kind==='human_handoff'?'Human handoff pending':'Review request pending',body:r.message.slice(0,120),ts:r.created_at});else out.push({id:'r-'+r.id,kind:'success',title:'Request reviewed',body:r.kind.replaceAll('_',' '),ts:r.created_at});}
for(const c of cases){if(c.inbox_state==='attention')out.push({id:'c-'+c.id,kind:'error',title:'Inbox case needs attention',body:c.order_label,ts:c.expires_at});}
return out.sort((a,b)=>b.ts.localeCompare(a.ts));}
export default function Support(){const[cases,setCases]=useState<InboxCase[]>([]);const [requests,setRequests]=useState<Request[]>([]),[token,setToken]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[branding,setBranding]=useState({label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question','Request refund review','Talk to a person'],allowedOrigins:[] as string[],excludedPaths:[] as string[],autoOpen:false,side:'right',hideSources:false,hideOrder:false,hideContact:false});
 async function load(){const r=await fetch('/api/support',{headers:await authHeaders()});const d=await r.json();if(d.error)setNotice(d.error);else {setRequests(d.requests);setCases(d.cases??[]);if(d.settings)setBranding(previous=>({...previous,...d.settings}));}}
 useEffect(()=>{authHeaders().then(headers=>fetch('/api/support',{headers})).then(r=>r.json()).then(d=>{if(d.error)setNotice(d.error);else {setRequests(d.requests);setCases(d.cases??[]);if(d.settings)setBranding(previous=>({...previous,...d.settings}));}}).catch(()=>setNotice('Could not load queue.'));},[]);
 async function action(body:unknown){setBusy(true);try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)});const d=await r.json();setNotice(d.note??d.error);if(d.token)setToken(d.token);await load();}catch{setNotice('Request failed.');}finally{setBusy(false);}}
 const snippet=token?`<script src="${typeof window!=='undefined'?location.origin:''}/widget.js" data-demo-token="${token}" defer></script>`:'';
 const pending=requests.filter(r=>r.status==='pending_review').length;
 return <DeskShell widget><DashShell crumb="Widget studio" notifications={buildNotifs(requests,cases)}><main style={{display:'contents'}}>
<header>
<p className="ap-dash-kicker">Customer support / fictional sandbox</p>
<h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>A customer question. A clear next step.</span></span></h1>
<p className="ap-dash-sub">Answer questions from your loaded knowledge with an embeddable support panel and a private review queue. This prototype uses fictional orders. It does not connect a business&apos;s real PayPal account or issue refunds.</p>
<div style={{display:'flex',alignItems:'center',gap:12,marginTop:14,flexWrap:'wrap'}}>
<button disabled={busy} onClick={()=>action({action:'create_demo'})} className="ap-dash-btn"><DIcon name="widget" size={13}/>Create one-hour fictional demo</button>
<p role="status" className="ap-dash-muted" style={{margin:0,wordBreak:'break-word'}}>{notice}</p>
</div>
</header>
<div className="ap-dash-kpis" style={{gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))'}}>
<article className="ap-dash-kpi"><h3><DIcon name="tickets" size={13}/>Inbox cases</h3><p>{cases.length}</p><span className="ap-dash-chip">live snapshot</span></article>
<article className={'ap-dash-kpi'+(pending?' ap-dash-kpi-alert':'')}><h3><DIcon name="alert" size={13}/>Pending review</h3><p>{pending}</p><span className="ap-dash-chip">live snapshot</span></article>
<article className="ap-dash-kpi"><h3><DIcon name="checkcircle" size={13}/>Requests</h3><p>{requests.length}</p><span className="ap-dash-chip">live snapshot</span></article>
</div>
<section className="ap-dash-card"><h2 className="ap-dash-h2">Make the demo yours</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Tenant-scoped label, monogram and color. Image logos are not supported yet. No scripts, HTML or remote tracking images.</p>
<div className="ap-dash-filters" style={{marginTop:14}}>
<label className="ap-dash-field">Widget label<input maxLength={40} value={branding.label} onChange={e=>setBranding({...branding,label:e.target.value})} className="ap-dash-select"/></label>
<label className="ap-dash-field">Monogram<input maxLength={3} value={branding.initials} onChange={e=>setBranding({...branding,initials:e.target.value})} className="ap-dash-select"/></label>
<label className="ap-dash-field">Accent<input type="color" value={branding.color} onChange={e=>setBranding({...branding,color:e.target.value})} className="ap-dash-select" style={{height:40,padding:4}}/></label>
</div>
<label className="ap-dash-field" style={{marginTop:12}}>Quick prompts, up to four lines<textarea value={branding.prompts.join('\n')} onChange={e=>setBranding({...branding,prompts:e.target.value.split('\n').slice(0,4)})} className="ap-dash-select" rows={4} style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<section style={{marginTop:18,borderTop:'1.5px solid #EEF1F8',paddingTop:16}}><h3 className="ap-dash-h2" style={{fontSize:15}}>Embed controls</h3>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>External embeds are off until you allow an exact HTTPS origin. These controls hide the widget, not the underlying demo capability: anyone with a valid link can still open the hosted demo. Excluded paths are exact paths and their children. No wildcard domains, page text or query strings are collected.</p>
<label className="ap-dash-field" style={{marginTop:12}}>Allowed external origins (one per line)<textarea rows={3} value={branding.allowedOrigins.join('\n')} onChange={e=>setBranding({...branding,allowedOrigins:e.target.value.split('\n').filter(Boolean).slice(0,10)})} placeholder="https://your-test-site.example" className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<label className="ap-dash-field" style={{marginTop:12}}>Excluded paths (one per line)<textarea rows={3} value={branding.excludedPaths.join('\n')} onChange={e=>setBranding({...branding,excludedPaths:e.target.value.split('\n').filter(Boolean).slice(0,20)})} placeholder="/account" className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<label className="ap-dash-field" style={{marginTop:12,flexDirection:'row',alignItems:'center',gap:8}}>Button position<select value={branding.side} onChange={e=>setBranding({...branding,side:e.target.value})} className="ap-dash-select" style={{width:'auto',marginTop:0}}><option value="right">Right</option><option value="left">Left</option></select></label>
<div style={{display:'flex',flexDirection:'column',gap:9,marginTop:12}}>{([['autoOpen','Open automatically on first visit'],['hideSources','Hide supporting quotes (not a privacy boundary)'],['hideOrder','Hide fictional order card'],['hideContact','Hide optional contact field']] as const).map(([key,label])=><label key={key} className="ap-dash-checkrow"><input type="checkbox" checked={branding[key]} onChange={e=>setBranding({...branding,[key]:e.target.checked})}/>{label}</label>)}</div>
<p className="ap-dash-muted" style={{margin:'10px 0 0'}}>The chat frame loads only when opened. Open/closed state persists within this tab while navigating.</p>
</section>
<button disabled={busy} onClick={()=>action({action:'settings',settings:branding})} className="ap-dash-btn ap-dash-btn-ghost" style={{marginTop:14}}>Save widget settings</button>
</section>
{token&&<section className="ap-dash-card"><h2 className="ap-dash-h2">Embed preview</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Anyone with this demo token can submit up to five requests for this fictional case. It expires in one hour. Do not use it for real customers.</p>
<pre className="ap-dash-snippet">{snippet}</pre>
<a href={'/help?token='+token} target="_blank" rel="noreferrer" style={{display:'inline-block',margin:'12px 0',fontSize:13,color:'#09318D',textDecoration:'underline'}}>Open customer demo ↗</a>
<iframe title="Fictional customer support preview" referrerPolicy="no-referrer" src={'/help?token='+token} style={{height:650,width:'100%',maxWidth:420,borderRadius:16,border:'1.5px solid #E2E7F2'}}/></section>}
<section className="ap-dash-card"><h2 className="ap-dash-h2">Handoff inbox</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Take over pauses AI answers, including answers still being checked. Release reopens the case; resolve closes it. This preview does not send human replies or emails. A link still expires after one hour.</p>
<div style={{marginTop:8}}>{cases.map(c=><div key={c.id} className="ap-dash-row" style={{flexWrap:'wrap',gap:10}}>
<div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap',flex:1,minWidth:200}}><span style={{fontSize:12.5,fontWeight:600,color:'#0A1B3D',wordBreak:'break-word'}}>{c.order_label}</span><span className={'ap-dash-badge '+(c.inbox_state==='attention'?'ap-dash-b-err':c.inbox_state==='closed'?'ap-dash-b-ok':'ap-dash-b-info')}>{c.inbox_state.replace('_',' ')}</span><small style={{color:'#93A3C7'}}>{c.id.slice(0,8)}</small></div>
<div style={{display:'flex',flexWrap:'wrap',gap:6}}>
{c.inbox_state!=='taken_over'&&c.inbox_state!=='closed'&&<button disabled={busy} onClick={()=>action({action:'inbox',id:c.id,state:'taken_over'})} className="ap-dash-btn ap-dash-btn-ghost" style={{padding:'7px 12px',fontSize:11.5}}>Take over</button>}
{(c.inbox_state==='taken_over'||c.inbox_state==='closed')&&<button disabled={busy} onClick={()=>action({action:'inbox',id:c.id,state:'open'})} className="ap-dash-btn ap-dash-btn-ghost" style={{padding:'7px 12px',fontSize:11.5}}>Release / reopen</button>}
{c.inbox_state!=='closed'&&<button disabled={busy} onClick={()=>action({action:'inbox',id:c.id,state:'closed'})} className="ap-dash-btn ap-dash-btn-ghost" style={{padding:'7px 12px',fontSize:11.5}}>Resolve / close</button>}
</div></div>)}{!cases.length&&<p className="ap-dash-muted" style={{marginTop:8}}>No cases loaded.</p>}</div>
</section>
<section className="ap-dash-card"><h2 className="ap-dash-h2">Review queue</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Requests are not payment instructions. Marking reviewed does not approve or issue a refund.</p>
{!requests.length&&<p className="ap-dash-muted" style={{marginTop:10,border:'1.5px dashed #DDE3F0',borderRadius:14,padding:24,textAlign:'center'}}>No demo requests yet.</p>}
<div style={{display:'flex',flexDirection:'column',gap:12,marginTop:12}}>{requests.map((r,i)=><article key={r.id} className="ap-dash-card" style={{animationDelay:`${Math.min(i,8)*.05}s`,boxShadow:'none'}}>
<div style={{display:'flex',flexWrap:'wrap',justifyContent:'space-between',gap:8,alignItems:'center'}}><h3 style={{margin:0,fontSize:13.5,fontWeight:650,color:'#0A1B3D',textTransform:'capitalize'}}>{r.kind.replaceAll('_',' ')}</h3><span className={'ap-dash-badge '+(r.status==='pending_review'?'ap-dash-b-info':'ap-dash-b-ok')}>{r.status.replaceAll('_',' ')}</span></div>
<p style={{margin:'10px 0 0',fontSize:13,lineHeight:1.65,color:'#0A1B3D',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{r.message}</p>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>{r.contact_email&&r.contact_consent?`Consented demo contact: ${r.contact_email}`:'No contact address shared'}</p>
<p className="ap-dash-muted" style={{margin:'4px 0 0',fontSize:10}}>{new Date(r.created_at).toLocaleString()}</p>
{r.status==='pending_review'&&<button disabled={busy} onClick={()=>action({action:'review',id:r.id})} className="ap-dash-btn ap-dash-btn-ghost" style={{marginTop:12}}>Mark reviewed, no payment action</button>}
</article>)}</div>
</section>
</main></DashShell></DeskShell>;
}
