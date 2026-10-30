'use client';
import DeskShell from '../components/DeskShell';
import DashShell,{DashNotif,DIcon} from '../components/DashShell';
import ServiceFields from './service-fields';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {authHeaders} from '../../lib/browser-auth';
import {ticketLabel,ageLabel,ticketCsv,transitions,type Ticket} from '../../lib/tickets';
type Event={id:string;created_at:string;kind:string;body:string};
type Timeline={events:Event[];requests:{id:string;created_at:string;kind:string;message:string;status:string;contact_email?:string|null}[];questions:{id:string;created_at:string;question:string;supported:boolean;feedback:number|null}[];coverage:string};
const statuses=['new','open','pending','resolved','closed'],priorities=['low','normal','high','urgent'],categories=['general','billing','refund','receipt','handoff','knowledge'];
function buildNotifs(rows:Ticket[]):DashNotif[]{const out:DashNotif[]=[];
for(const t of rows){const open=!['resolved','closed'].includes(t.ticket_status);
const attn=open&&(t.inbox_state==='attention'||['high','urgent'].includes(t.priority)||['refund','handoff'].includes(t.category));
if(attn)out.push({id:'t-'+t.id,kind:'error',title:'Ticket needs intervention',body:`${ticketLabel(t.id)} · ${t.order_label} · ${t.ticket_status} / ${t.priority} / ${t.category}`,ts:t.ticket_updated_at});
else if(!open)out.push({id:'t-'+t.id,kind:'success',title:'Ticket '+t.ticket_status,body:`${ticketLabel(t.id)} · ${t.order_label}`,ts:t.ticket_updated_at});
else out.push({id:'t-'+t.id,kind:'info',title:t.ticket_status==='new'?'New ticket':'Ticket '+t.ticket_status,body:`${ticketLabel(t.id)} · ${t.order_label} · ${t.priority} / ${t.category}`,ts:t.ticket_updated_at});}
return out.sort((a,b)=>b.ts.localeCompare(a.ts));}
export default function Tickets(){const[rows,setRows]=useState<Ticket[]>([]),[asOf,setAsOf]=useState(0),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[priority,setPriority]=useState('all'),[category,setCategory]=useState('all'),[assignment,setAssignment]=useState('all'),[sort,setSort]=useState('updated'),[selected,setSelected]=useState<string[]>([]),[bulk,setBulk]=useState('open'),[active,setActive]=useState<string|null>(null),[timeline,setTimeline]=useState<Timeline|null>(null),[note,setNote]=useState(''),[tags,setTags]=useState('');
async function load(){const r=await fetch('/api/tickets',{headers:await authHeaders()}),d=await r.json();if(!r.ok)throw Error(d.error);setRows(d.tickets);setAsOf(Date.now());return d.truncated;}
async function detail(id:string){setActive(id);setTimeline(null);setNote('');setTags(rows.find(t=>t.id===id)?.tags.join(', ')??'');try{const r=await fetch('/api/tickets?id='+id,{headers:await authHeaders()}),d=await r.json();if(!r.ok)throw Error(d.error);setTimeline(d);}catch{setNotice('Could not load ticket timeline.');}}
useEffect(()=>{authHeaders().then(headers=>fetch('/api/tickets',{headers})).then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);setRows(d.tickets);setAsOf(Date.now());const requested=new URLSearchParams(location.search).get('ticket');const initial=d.tickets.find((t:Ticket)=>t.id===requested);if(initial){setActive(initial.id);setTags(initial.tags.join(', '));authHeaders().then(headers=>fetch('/api/tickets?id='+initial.id,{headers})).then(r=>r.json()).then(x=>{if(x.error)throw Error(x.error);setTimeline(x);}).catch(()=>setNotice('Could not load ticket timeline.'));}setNotice(d.truncated?'Latest 200 only. Filters cover loaded rows.':'Latest up to 200 tickets loaded.');}).catch(()=>setNotice('Please sign in or retry when the service recovers.'));},[]);
async function act(body:unknown){setBusy(true);try{const r=await fetch('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)}),d=await r.json();setNotice(d.note??d.error);await load();if(r.ok){setSelected([]);if(active)await detail(active);}}catch{setNotice('Outcome unconfirmed. Refresh before retrying.');}finally{setBusy(false);}}
const visible=rows.filter(t=>(status==='all'||t.ticket_status===status)&&(priority==='all'||t.priority===priority)&&(category==='all'||t.category===category)&&(assignment==='all'||(assignment==='owner')===t.assigned_to_owner)&&`${ticketLabel(t.id)} ${t.id} ${t.order_label} ${t.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>sort==='oldest'?a.created_at.localeCompare(b.created_at):sort==='priority'?priorities.indexOf(b.priority)-priorities.indexOf(a.priority):b.ticket_updated_at.localeCompare(a.ticket_updated_at));
const current=rows.find(t=>t.id===active),events=timeline?[...timeline.events.map(e=>({...e,label:e.kind.replaceAll('_',' ')})),...timeline.requests.map(e=>({...e,body:e.message+(e.contact_email?'\nFollow-up email (visitor consented): '+e.contact_email:''),label:'Visitor request: '+e.kind.replaceAll('_',' ')})),...timeline.questions.map(e=>({...e,body:e.question,label:`Visitor question · ${e.supported?'supported':'unanswered'}${e.feedback===-1?' · negative feedback':''}`}))].sort((a,b)=>a.created_at.localeCompare(b.created_at)):[];
function exportCsv(){const blob=new Blob([ticketCsv(visible)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='automatepal-fictional-tickets.csv';a.click();URL.revokeObjectURL(url);}
const pb=(p:string)=>['high','urgent'].includes(p)?'ap-dash-b-err':p==='normal'?'ap-dash-b-info':'ap-dash-b-mut';
const sb=(s:string)=>['resolved','closed'].includes(s)?'ap-dash-b-ok':s==='pending'?'ap-dash-b-info':'ap-dash-b-err';
return <DeskShell widget><DashShell crumb="Tickets" notifications={buildNotifs(rows)}><main style={{display:'contents'}}>
<header>
<p className="ap-dash-kicker">Fictional support workspace</p>
<h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Tickets, with a clear next step.</span></span></h1>
<p className="ap-dash-sub">One ticket per demo case. Unanswered questions, negative feedback and review requests open it for attention. Notes are internal, not customer replies. Demo access still expires after one hour. No real customer data, email, refund or SLA.</p>
<div style={{display:'flex',alignItems:'center',gap:12,marginTop:14,flexWrap:'wrap'}}>
<button disabled={busy} onClick={()=>{setBusy(true);load().then(()=>setNotice('Tickets refreshed.')).catch(()=>setNotice('Refresh failed.')).finally(()=>setBusy(false));}} className="ap-dash-btn"><DIcon name="refresh" size={13}/>Refresh tickets</button>
<button onClick={()=>{setStatus('all');setCategory('handoff');setSort('updated');}} className="ap-dash-btn ap-dash-btn-ghost"><DIcon name="alert" size={13}/>Escalations only</button>
<button onClick={exportCsv} className="ap-dash-btn ap-dash-btn-ghost">Export filtered CSV</button>
<span className="ap-dash-muted" style={{margin:0}}>{visible.length} shown · loaded rows only, no notes or contacts in CSV</span>
</div>
<p role="status" className="ap-dash-muted" style={{marginTop:10}}>{notice}</p>
</header>
<section aria-label="Ticket filters" className="ap-dash-card ap-dash-filters">
<label className="ap-dash-field">Search ticket, fixture or tag<input value={search} onChange={e=>setSearch(e.target.value)} maxLength={160} className="ap-dash-select"/></label>
{([['Status',status,setStatus,statuses],['Priority',priority,setPriority,priorities],['Category',category,setCategory,categories],['Assignee',assignment,setAssignment,['owner','unassigned']],['Sort',sort,setSort,['updated','oldest','priority']]] as const).map(([label,value,set,choices])=><label key={label} className="ap-dash-field">{label}<select value={value} onChange={e=>set(e.target.value)} className="ap-dash-select">{label!=='Sort'&&<option value="all">All</option>}{choices.map(v=><option key={v} value={v}>{v}</option>)}</select></label>)}
</section>
<div className="ap-dash-card" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12}}>
<label className="ap-dash-checkrow"><input type="checkbox" checked={visible.length>0&&visible.slice(0,50).every(t=>selected.includes(t.id))} onChange={e=>setSelected(e.target.checked?visible.slice(0,50).map(t=>t.id):[])}/>Select first 50 shown</label>
<label className="ap-dash-field" style={{flexDirection:'row',alignItems:'center',gap:8}}>Bulk status<select aria-label="Bulk status" value={bulk} onChange={e=>setBulk(e.target.value)} className="ap-dash-select" style={{marginTop:0,width:'auto'}}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
<button disabled={busy||!selected.length} onClick={()=>act({ids:selected,patch:{status:bulk}})} className="ap-dash-btn ap-dash-btn-ghost">Apply to {selected.length} selected</button>
</div>
<div className="ap-dash-ticketgrid">
<section aria-label="Ticket list" style={{display:'flex',flexDirection:'column',gap:10}}>
{!visible.length&&<p className="ap-dash-card ap-dash-muted" style={{borderStyle:'dashed'}}>No loaded tickets match. <Link href="/setup" style={{color:'#09318D',textDecoration:'underline'}}>Create a fictional demo in Quick setup</Link>.</p>}
{visible.map((t,i)=><article key={t.id} className={'ap-dash-card ap-dash-ticket'+(active===t.id?' ap-dash-ticket-active':'')} style={{animationDelay:`${Math.min(i,10)*.05}s`}}>
<div style={{display:'flex',alignItems:'flex-start',gap:11}}>
<input type="checkbox" aria-label={'Select '+ticketLabel(t.id)} checked={selected.includes(t.id)} onChange={e=>setSelected(e.target.checked?[...selected,t.id].slice(0,50):selected.filter(id=>id!==t.id))} style={{marginTop:3}}/>
<div style={{minWidth:0,flex:1}}>
<button onClick={()=>detail(t.id)} className="ap-dash-ticket-id">{ticketLabel(t.id)}</button>
<p style={{margin:'4px 0 0',fontSize:13,fontWeight:550,color:'#0A1B3D',wordBreak:'break-word'}}>{t.order_label}</p>
<div style={{marginTop:9,display:'flex',flexWrap:'wrap',gap:6}}><span className={'ap-dash-badge '+sb(t.ticket_status)}>{t.ticket_status}</span><span className={'ap-dash-badge '+pb(t.priority)}>{t.priority}</span><span className="ap-dash-badge ap-dash-b-mut">{t.category}</span></div>
<p className="ap-dash-muted" style={{margin:'9px 0 0'}}>Age {ageLabel(t.created_at,asOf)} · {t.assigned_to_owner?'Owner':'Unassigned'} · {t.first_reviewed_at?'First owner review after '+ageLabel(t.created_at,Date.parse(t.first_reviewed_at)):'Awaiting first owner review'}</p>
<p className="ap-dash-muted" style={{margin:'4px 0 0'}}>AI {['taken_over','closed'].includes(t.inbox_state)?'paused':'available'} · {Date.parse(t.expires_at)<=asOf?'Demo link expired':'Demo link active'}</p>
<p className="ap-dash-muted" style={{margin:'4px 0 0'}}>{t.ticket_type??'question'} · queue {t.assignment_queue??'general'}</p>
{t.tags.length>0&&<p style={{margin:'7px 0 0',fontSize:11,color:'#09318D',wordBreak:'break-word'}}>{t.tags.join(' · ')}</p>}
</div></div></article>)}
</section>
{current&&<section aria-label="Ticket details" className="ap-dash-card" style={{alignSelf:'start'}}>
<h2 className="ap-dash-h2">{ticketLabel(current.id)}</h2>
<p className="ap-dash-muted" style={{margin:'6px 0 0',wordBreak:'break-all'}}>Full ticket ID: {current.id}</p>
<div className="ap-dash-filters" style={{marginTop:14}}>
{([['Status','status',current.ticket_status,statuses],['Priority','priority',current.priority,priorities],['Category','category',current.category,categories]] as const).map(([label,key,value,choices])=><label key={key} className="ap-dash-field">{label}<select aria-label={'Ticket '+label} disabled={busy} value={value} onChange={e=>act({ids:[current.id],patch:{[key]:e.target.value}})} className="ap-dash-select">{choices.filter(v=>key!=='status'||v===current.ticket_status||transitions[current.ticket_status]?.includes(v)).map(v=><option key={v}>{v}</option>)}</select></label>)}
<label className="ap-dash-field">Assignee<select aria-label="Ticket assignee" disabled={busy} value={current.assigned_to_owner?'owner':'unassigned'} onChange={e=>act({ids:[current.id],patch:{assigned:e.target.value==='owner'}})} className="ap-dash-select"><option value="unassigned">Unassigned</option><option value="owner">Owner (single workspace owner)</option></select></label>
</div>
<div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}><button disabled={busy} onClick={()=>act({ids:[current.id],patch:{takeover:current.inbox_state!=='taken_over',status:'pending'}})} className="ap-dash-btn ap-dash-btn-ghost">{current.inbox_state==='taken_over'?'Release AI':'Take over / pause AI'}</button></div>
<p className="ap-dash-muted" style={{margin:'10px 0 0'}}>Resolved/closed also pause AI. Reopening does not extend the demo link. First owner review is not a customer-response or SLA metric. Team assignments and outbound replies are not enabled.</p>
<label className="ap-dash-field" style={{marginTop:12}}>Tags, comma-separated (max 8, letters/numbers/_/-)<input value={tags} onChange={e=>setTags(e.target.value)} maxLength={210} className="ap-dash-select"/></label>
<button disabled={busy} onClick={()=>act({ids:[current.id],patch:{tags:tags.split(',').map(t=>t.trim()).filter(Boolean)}})} className="ap-dash-btn ap-dash-btn-ghost" style={{marginTop:8}}>Save tags</button>
<label className="ap-dash-field" style={{marginTop:12}}>Internal note<textarea value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} rows={3} placeholder="Fictional details only. No secrets or customer information." className="ap-dash-select" style={{resize:'vertical',fontFamily:'inherit'}}/></label>
<button disabled={busy||!note.trim()} onClick={()=>act({action:'note',id:current.id,body:note})} className="ap-dash-btn" style={{marginTop:8}}>Save internal note</button>
<ServiceFields key={current.id+current.ticket_updated_at} ticket={current} rows={rows} busy={busy} act={act}/>
<h3 className="ap-dash-h2" style={{borderTop:'1.5px solid #EEF1F8',paddingTop:16,marginTop:18}}>Activity stream (internal work notes)</h3>
<p className="ap-dash-muted" style={{margin:'6px 0 0'}}>{timeline?.coverage??'Loading...'}</p>
<ol style={{listStyle:'none',margin:'12px 0 0',padding:0,display:'flex',flexDirection:'column',gap:14}}>{events.map((e,i)=><li key={e.id+'-'+i} style={{borderLeft:'2.5px solid #FD91CC',paddingLeft:12}}><p className="ap-dash-muted" style={{margin:0,fontSize:10}}>{new Date(e.created_at).toISOString()} · {e.label}</p><p style={{margin:'6px 0 0',fontSize:13,lineHeight:1.6,color:'#0A1B3D',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{e.body}</p></li>)}</ol>
</section>}
</div>
</main></DashShell></DeskShell>;
}
