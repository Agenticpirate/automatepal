"use client";
import {modeText} from '../../lib/app-mode';
import DeskShell from '../components/DeskShell';
import DashShell,{DashNotif,DIcon} from '../components/DashShell';
import {useEffect,useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
import {DAY_NAMES,DEFAULT_AWAY_MESSAGE,type WorkingHours} from '../../lib/working-hours';
type Request={id:string;created_at:string;kind:string;message:string;status:string;contact_email?:string;contact_consent?:boolean};
type InboxCase={id:string;order_label:string;inbox_state:'open'|'attention'|'taken_over'|'closed';expires_at:string};
function buildNotifs(requests:Request[],cases:InboxCase[]):DashNotif[]{const out:DashNotif[]=[];
for(const r of requests){if(r.status==='pending_review')out.push({id:'r-'+r.id,kind:'info',title:r.kind==='refund_request'?'Refund review pending':r.kind==='human_handoff'?'Human handoff pending':'Review request pending',body:r.message.slice(0,120),ts:r.created_at});else out.push({id:'r-'+r.id,kind:'success',title:'Request reviewed',body:r.kind.replaceAll('_',' '),ts:r.created_at});}
for(const c of cases){if(c.inbox_state==='attention')out.push({id:'c-'+c.id,kind:'error',title:'Inbox case needs attention',body:c.order_label,ts:c.expires_at});}
return out.sort((a,b)=>b.ts.localeCompare(a.ts));}
export default function Support(){const[cases,setCases]=useState<InboxCase[]>([]);const [requests,setRequests]=useState<Request[]>([]),[token,setToken]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[branding,setBranding]=useState({label:'Site help',color:'#233de8',initials:'AP',prompts:['Ask a question','Request refund review','Talk to a person'],allowedOrigins:[] as string[],excludedPaths:[] as string[],autoOpen:false,side:'right',hideSources:false,hideOrder:false,hideContact:false,visitorChoice:true,followUps:[] as string[],maxQuestions:20,workingHours:{enabled:false,timezone:'UTC',days:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),awayMessage:DEFAULT_AWAY_MESSAGE} as WorkingHours}),[zones,setZones]=useState<string[]>([]);
 async function load(){const r=await fetch('/api/support',{headers:await authHeaders()});const d=await r.json();if(d.error)setNotice(d.error);else {setRequests(d.requests);setCases(d.cases??[]);if(d.settings)setBranding(previous=>({...previous,...d.settings}));}}
 useEffect(()=>{Promise.resolve().then(()=>{try{setZones(Intl.supportedValuesOf('timeZone'));}catch{}});},[]);
 useEffect(()=>{authHeaders().then(headers=>fetch('/api/support',{headers})).then(r=>r.json()).then(d=>{if(d.error)setNotice(d.error);else {setRequests(d.requests);setCases(d.cases??[]);if(d.settings)setBranding(previous=>({...previous,...d.settings}));}}).catch(()=>setNotice('Could not load queue.'));},[]);
 async function action(body:unknown){setBusy(true);try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)});const d=await r.json();setNotice(d.note??d.error);if(d.token)setToken(d.token);await load();}catch{setNotice('Request failed.');}finally{setBusy(false);}}
 const snippet=token?`<script src="${typeof window!=='undefined'?location.origin:''}/widget.js" data-demo-token="${token}" defer></script>`:'';
 const pending=requests.filter(r=>r.status==='pending_review').length;
 return <DeskShell widget><DashShell crumb="Widget studio" notifications={buildNotifs(requests,cases)}><main style={{display:'contents'}}>
<header>
<p className="ap-dash-kicker">{modeText('Customer support / fictional sandbox','Customer support')}</p>
<h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>A customer question. A clear next step.</span></span></h1>
<p className="ap-dash-sub">Answer questions from your loaded knowledge with an embeddable support panel and a private review queue. {modeText('This prototype uses fictional orders. It does not connect a business\'s real PayPal account or issue refunds.','Test chats use a sample order. Billing connections are read-only, and refunds are never issued automatically.')}</p>
<div style={{display:'flex',alignItems:'center',gap:12,marginTop:14,flexWrap:'wrap'}}>
<button disabled={busy} onClick={()=>action({action:'create_demo'})} className="ap-dash-btn"><DIcon name="widget" size={13}/>{modeText('Create one-hour fictional demo','Create a one-hour test chat')}</button>
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
<label className="ap-dash-field" style={{marginTop:12}}>Follow-up suggestions after answers, up to six lines<textarea value={branding.followUps.join('\n')} onChange={e=>setBranding({...branding,followUps:e.target.value.split('\n').slice(0,6)})} className="ap-dash-select" rows={4} maxLength={490} placeholder="Do you ship to Pune?" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<p className="ap-dash-muted" style={{margin:'6px 0 0'}}>Plain text, 3 to 80 characters each, no angle brackets. After an answer the widget shows the first three, in this order, as buttons that ask the question. Empty lines are dropped.</p>
<section style={{marginTop:18,borderTop:'1.5px solid #EEF1F8',paddingTop:16}}><h3 className="ap-dash-h2" style={{fontSize:15}}>Embed controls</h3>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>External embeds are off until you allow an exact HTTPS origin. These controls hide the widget, not the underlying demo capability: anyone with a valid link can still open the hosted demo. Excluded paths are exact paths and their children. No wildcard domains, page text or query strings are collected.</p>
<label className="ap-dash-field" style={{marginTop:12}}>Allowed external origins (one per line)<textarea rows={3} value={branding.allowedOrigins.join('\n')} onChange={e=>setBranding({...branding,allowedOrigins:e.target.value.split('\n').filter(Boolean).slice(0,10)})} placeholder="https://your-test-site.example" className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<label className="ap-dash-field" style={{marginTop:12}}>Excluded paths (one per line)<textarea rows={3} value={branding.excludedPaths.join('\n')} onChange={e=>setBranding({...branding,excludedPaths:e.target.value.split('\n').filter(Boolean).slice(0,20)})} placeholder="/account" className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<label className="ap-dash-field" style={{marginTop:12,flexDirection:'row',alignItems:'center',gap:8}}>Button position<select value={branding.side} onChange={e=>setBranding({...branding,side:e.target.value})} className="ap-dash-select" style={{width:'auto',marginTop:0}}><option value="right">Right</option><option value="left">Left</option></select></label>
<div style={{display:'flex',flexDirection:'column',gap:9,marginTop:12}}>{([['autoOpen','Open automatically on first visit'],['hideSources','Hide supporting quotes (not a privacy boundary)'],['hideOrder',modeText('Hide fictional order card','Hide sample order card')],['hideContact','Hide optional contact field']] as const).map(([key,label])=><label key={key} className="ap-dash-checkrow"><input type="checkbox" checked={branding[key]} onChange={e=>setBranding({...branding,[key]:e.target.checked})}/>{label}</label>)}</div>
<p className="ap-dash-muted" style={{margin:'10px 0 0'}}>The chat frame loads only when opened. Open/closed state persists within this tab while navigating.</p>
<label className="ap-dash-field" style={{marginTop:12,maxWidth:280}}>AI answers per conversation (1-50)<input type="number" min={1} max={50} value={branding.maxQuestions} onChange={e=>setBranding({...branding,maxQuestions:Math.min(50,Math.max(1,Math.round(Number(e.target.value)||1)))})} className="ap-dash-select"/></label>
<p className="ap-dash-muted" style={{margin:'6px 0 0'}}>After this many questions in one conversation the AI stops and the visitor can still ask for a person. Limits cost from a single visitor.</p>
</section>
<section aria-label="Working hours" style={{marginTop:18,borderTop:'1.5px solid #EEF1F8',paddingTop:16}}><h3 className="ap-dash-h2" style={{fontSize:15}}>Working hours</h3>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>When a visitor asks for a person outside these hours, the widget shows your away message and saves the request for the team. Replies happen in the widget after you take over in Tickets. You can also email a reply to a visitor who left an address with consent.</p>
<label className="ap-dash-checkrow" style={{marginTop:12}}><input type="checkbox" checked={branding.visitorChoice} onChange={e=>setBranding({...branding,visitorChoice:e.target.checked})}/>Let visitors choose AI or a person</label>
<label className="ap-dash-checkrow" style={{marginTop:9}}><input type="checkbox" checked={branding.workingHours.enabled} onChange={e=>setBranding({...branding,workingHours:{...branding.workingHours,enabled:e.target.checked}})}/>Use working hours for the person handoff</label>
<label className="ap-dash-field" style={{marginTop:12}}>Time zone<input list="ap-time-zones" maxLength={64} value={branding.workingHours.timezone} onChange={e=>setBranding({...branding,workingHours:{...branding.workingHours,timezone:e.target.value}})} className="ap-dash-select" placeholder="Asia/Kolkata"/></label>
<datalist id="ap-time-zones">{zones.map(z=><option key={z} value={z}/>)}</datalist>
<div style={{display:'flex',flexDirection:'column',gap:8,marginTop:12}}>{DAY_NAMES.map((name,day)=>{const range=branding.workingHours.days.find(d=>d.day===day);const set=(next:{start:string;end:string}|null)=>setBranding({...branding,workingHours:{...branding.workingHours,days:[...branding.workingHours.days.filter(d=>d.day!==day),...(next?[{day,...next}]:[])].sort((a,b)=>a.day-b.day)}});return <div key={name} role="group" aria-label={name+' hours'} style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:8}}>
<label className="ap-dash-checkrow" style={{minWidth:120}}><input type="checkbox" checked={!!range} onChange={e=>set(e.target.checked?{start:'09:00',end:'17:00'}:null)}/>{name}</label>
{range?<><label className="ap-dash-field" style={{flexDirection:'row',alignItems:'center',gap:6}}>Opens<input type="time" aria-label={name+' opens'} value={range.start} onChange={e=>set({start:e.target.value,end:range.end})} className="ap-dash-select" style={{width:'auto',marginTop:0}}/></label><label className="ap-dash-field" style={{flexDirection:'row',alignItems:'center',gap:6}}>Closes<input type="time" aria-label={name+' closes'} value={range.end} onChange={e=>set({start:range.start,end:e.target.value})} className="ap-dash-select" style={{width:'auto',marginTop:0}}/></label></>:<span className="ap-dash-muted">Closed</span>}
</div>;})}</div>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>A closing time earlier than the opening time runs past midnight.</p>
<label className="ap-dash-field" style={{marginTop:12}}>Away message<textarea rows={2} maxLength={300} value={branding.workingHours.awayMessage} onChange={e=>setBranding({...branding,workingHours:{...branding.workingHours,awayMessage:e.target.value}})} className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
</section>
<button disabled={busy} onClick={()=>action({action:'settings',settings:{...branding,followUps:branding.followUps.map(f=>f.trim()).filter(Boolean)}})} className="ap-dash-btn ap-dash-btn-ghost" style={{marginTop:14}}>Save widget settings</button>
</section>
{token&&<section className="ap-dash-card"><h2 className="ap-dash-h2">Embed preview</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>{modeText('Anyone with this demo token can submit up to five requests for this fictional case. It expires in one hour. Do not use it for real customers.','Anyone with this link can submit up to five requests in this test chat. It expires in one hour, so use it for testing.')}</p>
<pre className="ap-dash-snippet">{snippet}</pre>
<a href={'/help?token='+token} target="_blank" rel="noreferrer" style={{display:'inline-block',margin:'12px 0',fontSize:13,color:'#09318D',textDecoration:'underline'}}>Open customer demo ↗</a>
<iframe title={modeText('Fictional customer support preview','Customer support preview')} referrerPolicy="no-referrer" src={'/help?token='+token} style={{height:650,width:'100%',maxWidth:420,borderRadius:16,border:'1.5px solid #E2E7F2'}}/></section>}
<section className="ap-dash-card"><h2 className="ap-dash-h2">Handoff inbox</h2>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>Take over pauses AI answers, including answers still being checked. Release reopens the case; resolve closes it. After you take over, reply from Tickets; replies appear in the visitor&apos;s widget, and are emailed only when you choose to and the visitor gave an address with consent. A link still expires after one hour.</p>
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
