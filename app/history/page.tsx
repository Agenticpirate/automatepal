'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import DeskShell from '../components/DeskShell';
import DashShell,{DIcon} from '../components/DashShell';
import {authHeaders} from '../../lib/browser-auth';
import {downloadCsv} from '../../lib/exports';
import {filterConversations,transcriptsCsv,RETENTION_DAYS,type Conversation} from '../../lib/transcripts';
import {BotFilter,useBotFilter,withBot} from '../components/BotPicker';
/* Chat history: every conversation with its full transcript (visitor questions, AI answers, person chat and
   requests). Search, filter by date, status and source, open a transcript, export a formula-safe CSV of the
   filtered list, and delete one conversation (managers and up). Admins set the retention. */
type Data={conversations:Conversation[];total:number;truncated:boolean;retentionDays:number;role:string;coverage:string;demo?:boolean};
const when=(s:string)=>new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'UTC'})+' UTC';
const SOURCE_LABEL:Record<string,string>={widget:'Website widget',hosted_page:'Hosted help page',api:'API',mcp:'MCP'};
const AUTHOR:Record<string,string>={visitor:'Visitor',ai:'AI answer',owner:'Your team',request:'Request'};
const rank:Record<string,number>={owner:4,admin:3,manager:2,agent:1};
export default function History(){const botFilter=useBotFilter();
 const[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const[q,setQ]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[status,setStatus]=useState('all'),[source,setSource]=useState('all');
 const[open,setOpen]=useState<string|null>(null),[confirm,setConfirm]=useState<string|null>(null);
 const apply=useCallback((ok:boolean,d:Data&{error?:string})=>{if(!ok||d.error){setError(d.error??'Could not load chat history.');setData(null);}else{setError('');setData(d);}},[]);
 const load=useCallback(async()=>{const r=await fetch(withBot('/api/history',botFilter),{headers:await authHeaders()});apply(r.ok,await r.json());},[apply,botFilter]);
 useEffect(()=>{authHeaders().then(headers=>fetch(withBot('/api/history',botFilter),{headers})).then(async r=>apply(r.ok,await r.json())).catch(()=>setError('Could not load chat history.'));},[apply,botFilter]);
 const shown=useMemo(()=>data?filterConversations(data.conversations,{q,from,to,status,source}):[],[data,q,from,to,status,source]);
 const statuses=useMemo(()=>[...new Set((data?.conversations??[]).map(c=>c.status))].sort(),[data]);
 const role=rank[data?.role??'agent']??1;
 async function post(body:unknown){setBusy(true);try{const r=await fetch('/api/history',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)});const d=await r.json();setNotice(d.note??d.error);setConfirm(null);if(r.ok)await load();}catch{setNotice('Request failed.');}finally{setBusy(false);}}
 function exportCsv(){downloadCsv(`automatepal-chat-history-${new Date().toISOString().slice(0,10)}.csv`,transcriptsCsv(shown));setNotice(`Exported ${shown.length} conversation${shown.length===1?'':'s'} as CSV. Nothing was sent anywhere.`);}
 const active=shown.find(c=>c.id===open)??null;
 return <DeskShell><DashShell crumb="Chat history"><main style={{display:'contents'}}>
<header>
<p className="ap-dash-kicker">Customer support / chat history</p>
<h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Chat history</span></span></h1>
<p className="ap-dash-sub">Every conversation with its full transcript: what visitors asked, what the AI answered, and what your team wrote. Transcripts are deleted automatically after the retention period below.</p>
<BotFilter/>
</header>
{error&&<section className="ap-dash-card" role="alert"><p className="ap-dash-muted" style={{margin:0}}>{error}</p></section>}
{data&&<section className="ap-dash-card" aria-labelledby="hist-h">
<div style={{display:'flex',flexWrap:'wrap',alignItems:'flex-end',justifyContent:'space-between',gap:12}}>
<h2 id="hist-h" className="ap-dash-h2">Conversations <span className="ap-dash-chip">{shown.length} of {data.total}{data.truncated?'+':''}</span></h2>
<button type="button" disabled={!shown.length} onClick={exportCsv} className="ap-dash-btn ap-dash-btn-ghost"><DIcon name="audit" size={13}/>Export CSV</button>
</div>
<div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:10}}>
<label className="ap-dash-field">Search transcripts<input type="search" value={q} maxLength={200} onChange={e=>setQ(e.target.value)} placeholder="Words, or a ticket like T-1A2B" className="ap-dash-select"/></label>
<label className="ap-dash-field">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="ap-dash-select"/></label>
<label className="ap-dash-field">To<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="ap-dash-select"/></label>
<label className="ap-dash-field">Status<select value={status} onChange={e=>setStatus(e.target.value)} className="ap-dash-select"><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></label>
<label className="ap-dash-field">Source<select value={source} onChange={e=>setSource(e.target.value)} className="ap-dash-select"><option value="all">All sources</option>{Object.entries(SOURCE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
</div>
<p className="ap-dash-muted" style={{margin:'8px 0 0'}}>{data.coverage} CSV cells that start with = + - @ are escaped so spreadsheets treat them as text.</p>
<p role="status" className="ap-dash-muted" style={{margin:'8px 0 0',wordBreak:'break-word'}}>{notice}</p>
{!data.conversations.length&&<p className="ap-dash-muted" style={{marginTop:12,border:'1.5px dashed #DDE3F0',borderRadius:14,padding:24,textAlign:'center'}}>No conversations yet. When visitors use your widget, their conversations appear here.</p>}
{!!data.conversations.length&&!shown.length&&<p className="ap-dash-muted" style={{marginTop:12}}>No conversations match these filters.</p>}
<ul aria-label="Conversations" style={{listStyle:'none',margin:'10px 0 0',padding:0}}>{shown.map(c=><li key={c.id} className="ap-dash-row" style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10}}>
<div style={{flex:'1 1 240px',minWidth:0}}><p style={{margin:0,fontWeight:650,color:'#0A1B3D',overflowWrap:'anywhere'}}>{c.preview}</p>
<p className="ap-dash-muted" style={{margin:'2px 0 0',fontSize:11.5}}>{c.label} · {c.status.replace(/_/g,' ')} · {SOURCE_LABEL[c.source]??c.source} · {c.questions} question{c.questions===1?'':'s'}{c.unanswered?` (${c.unanswered} unanswered)`:''} · {when(c.last_at)}</p></div>
<div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
<button type="button" onClick={()=>setOpen(open===c.id?null:c.id)} aria-expanded={open===c.id} className="ap-dash-btn ap-dash-btn-ghost" aria-label={'Open transcript '+c.label} style={{minHeight:44}}>{open===c.id?'Close':'Transcript'}</button>
{!data.demo&&role>=2&&(confirm===c.id?<><button type="button" disabled={busy} onClick={()=>void post({action:'delete',id:c.id})} className="ap-dash-btn" style={{minHeight:44}}>Confirm delete</button><button type="button" disabled={busy} onClick={()=>setConfirm(null)} className="ap-dash-btn ap-dash-btn-ghost" style={{minHeight:44}}>Cancel</button></>
:<button type="button" disabled={busy} onClick={()=>{setConfirm(c.id);setNotice('');}} className="ap-dash-btn ap-dash-btn-ghost" aria-label={'Delete conversation '+c.label} style={{minHeight:44}}>Delete</button>)}
</div>
{active?.id===c.id&&<section aria-label={'Transcript '+c.label} style={{flex:'1 1 100%',borderTop:'1px solid #E6EAF3',paddingTop:10}}>
<ol style={{listStyle:'none',margin:0,padding:0,display:'grid',gap:8}}>{c.entries.map((e,i)=><li key={i} style={{padding:'8px 10px',borderRadius:10,background:e.author==='visitor'?'#F3F5FA':e.author==='ai'?'#EEF2FC':e.author==='owner'?'#FFF0F8':'#FAFAFA'}}>
<p style={{margin:0,fontSize:11.5,color:'#5B6478'}}><strong style={{color:'#041A52'}}>{AUTHOR[e.author]}</strong> · {when(e.at)}{e.meta?` · ${e.meta}`:''}</p>
<p style={{margin:'4px 0 0',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:13}}>{e.text}</p></li>)}</ol>
{!c.entries.length&&<p className="ap-dash-muted">This conversation has no messages yet.</p>}
<p className="ap-dash-muted" style={{marginTop:8}}><Link href={'/tickets?ticket='+c.id}>Open the ticket</Link></p>
</section>}
</li>)}</ul>
</section>}
{data&&<section className="ap-dash-card" aria-labelledby="ret-h">
<h2 id="ret-h" className="ap-dash-h2">Retention</h2>
<p className="ap-dash-muted" style={{margin:'6px 0 10px'}}>A conversation, with its transcript and ticket, is deleted automatically once its last activity is older than this. The deletion runs with the hourly scheduled job.</p>
<div className="ap-dash-toggle" role="group" aria-label="Keep transcripts for">{RETENTION_DAYS.map(d=><button key={d} type="button" aria-pressed={data.retentionDays===d} disabled={busy||!!data.demo||role<3} onClick={()=>void post({action:'retention',days:d})} style={{minHeight:44}}>{d} days{d===90?' (default)':''}</button>)}</div>
{role<3&&!data.demo&&<p className="ap-dash-muted" style={{marginTop:8}}>Only admins and the owner can change retention.</p>}
{data.demo&&<p className="ap-dash-muted" style={{marginTop:8}}>Demo preview: sign in to change retention or delete conversations.</p>}
</section>}
</main></DashShell></DeskShell>;
}
