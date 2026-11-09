'use client';
import {modeText} from '../../lib/app-mode';
import DeskShell from '../components/DeskShell';
import {formatMoney} from '../../lib/billing/core/money';
import DashShell,{type DashNotif} from '../components/DashShell';
import ServiceFields,{QaDraft} from './service-fields';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {authHeaders} from '../../lib/browser-auth';
import {ticketLabel,ageLabel,ticketCsv,transitions,type Ticket} from '../../lib/tickets';
import {I,type IconName,VIEWS,type ViewKey,needsYou,isOpenTicket,aiPaused,statusMeta,PRIORITY_COLOR,cap,words,shortAgo,whenLabel,fmtDur,weekSummary} from './inbox-ui';
import {Avatar,Participants,MascotCluster,handler,rowPreview,readPins,writePins} from './conversation-ui';
import {MESSAGE_MAX,POLL_MS} from '../../lib/support-messages';
import './inbox.css';
import {BotFilter,useBotFilter,withBot} from '../components/BotPicker';

type Event={id:string;created_at:string;kind:string;body:string};
type Timeline={events:Event[];requests:{id:string;created_at:string;kind:string;message:string;status:string;contact_email?:string|null}[];questions:{id:string;created_at:string;question:string;supported:boolean;feedback:number|null}[];payments?:Payment[];messages?:{id:string;created_at:string;author:'owner'|'visitor';body:string}[];coverage:string};
type Payment={requestId:string;provider:string;mode:string;kind:string|null;ref:string|null;status:string|null;amountMinor:number|null;currency:string|null};
const PROVIDER_LABEL:Record<string,string>={paypal:'PayPal',stripe:'Stripe',dodo:'Dodo Payments',razorpay:'Razorpay',paddle:'Paddle',square:'Square',adyen:'Adyen',mollie:'Mollie',chargebee:'Chargebee',lemonsqueezy:'Lemon Squeezy'};
const paymentLine=(p:Payment)=>'\nAttached payment: '+[PROVIDER_LABEL[p.provider]??p.provider,p.mode==='live'?'LIVE':'Test mode',[p.kind,p.ref].filter(Boolean).join(' '),p.status,formatMoney(p.amountMinor,p.currency)].filter(Boolean).join(' · ')+' · No refund executed';
type Item={id:string;created_at:string;label:string;body:string;team:boolean;chip?:string;who?:'owner'|'visitor'};
type Action={label:string;icon?:IconName;primary?:boolean;run?:()=>void;href?:string};
type CheckState='done'|'todo'|'wait'|'run';

/* Only called from event handlers and effects, never while rendering. */
const clock=()=>Date.now();
const statuses=['new','open','pending','resolved','closed'],priorities=['low','normal','high','urgent'],categories=['general','billing','refund','receipt','handoff','knowledge'];
const SORTS:[string,string][]=[['updated','Newest'],['oldest','Oldest'],['priority','Priority']];
/* Demo and older rows can hold values outside today's lists; keep the current value selectable. */
const withCurrent=(list:string[],cur:string)=>list.includes(cur)?list:[cur,...list];

function buildNotifs(rows:Ticket[]):DashNotif[]{const out:DashNotif[]=[];
for(const t of rows){const open=isOpenTicket(t);
if(needsYou(t))out.push({id:'t-'+t.id,kind:'error',title:'Ticket needs intervention',body:`${ticketLabel(t.id)} · ${t.order_label} · ${t.ticket_status} / ${t.priority} / ${t.category}`,ts:t.ticket_updated_at});
else if(!open)out.push({id:'t-'+t.id,kind:'success',title:'Ticket '+t.ticket_status,body:`${ticketLabel(t.id)} · ${t.order_label}`,ts:t.ticket_updated_at});
else out.push({id:'t-'+t.id,kind:'info',title:t.ticket_status==='new'?'New ticket':'Ticket '+t.ticket_status,body:`${ticketLabel(t.id)} · ${t.order_label} · ${t.priority} / ${t.category}`,ts:t.ticket_updated_at});}
return out.sort((a,b)=>b.ts.localeCompare(a.ts));}

function Check({state,text,status,extra}:{state:CheckState;text:string;status:string;extra?:React.ReactNode}){
 return <li className={'ap-ib-chk is-'+state}>
  <span className="ap-ib-chk-ic" aria-hidden="true">{state==='done'?<I n="tick" s={10} sw={3.2}/>:state==='todo'?'!':null}</span>
  <span className="ap-ib-chk-t">{text}</span>
  {extra}
  <span className="ap-ib-chk-s">{status}</span>
 </li>;
}

export default function Tickets(){const botFilter=useBotFilter();
 const[rows,setRows]=useState<Ticket[]>([]),[asOf,setAsOf]=useState(0),[loaded,setLoaded]=useState(false),[loadError,setLoadError]=useState(''),[loadNote,setLoadNote]=useState('');
 const[toast,setToast]=useState<{text:string;ok:boolean;n:number}|null>(null),[busy,setBusy]=useState(false);
 const[search,setSearch]=useState(''),[view,setView]=useState<ViewKey>('all'),[status,setStatus]=useState('all'),[priority,setPriority]=useState('all'),[category,setCategory]=useState('all'),[sort,setSort]=useState('updated'),[filtersOpen,setFiltersOpen]=useState(false);
 const[selected,setSelected]=useState<string[]>([]),[bulk,setBulk]=useState('open');
 const[active,setActive]=useState<string|null>(null),[timeline,setTimeline]=useState<Timeline|null>(null),[note,setNote]=useState(''),[tags,setTags]=useState(''),[editTags,setEditTags]=useState(false),[showAll,setShowAll]=useState(false);
 /* Composer mode (internal note or widget reply), the reply draft, browser-local pins and the header menu. */
 const[mode,setMode]=useState<'note'|'reply'>('note'),[reply,setReply]=useState(''),[emailVisitor,setEmailVisitor]=useState(false),[pins,setPins]=useState<string[]>([]),[menuOpen,setMenuOpen]=useState(false),[searchOpen,setSearchOpen]=useState(false);
 /* n changes on every message so a repeated toast re-mounts and replays its entrance. */
 const say=(text:string,ok:boolean)=>setToast(prev=>({text,ok,n:(prev?.n??0)+1}));

 useEffect(()=>{if(!toast)return;const id=window.setTimeout(()=>setToast(null),6000);return()=>window.clearTimeout(id);},[toast]);

 async function load(){const r=await fetch(withBot('/api/tickets',botFilter),{headers:await authHeaders()}),d=await r.json();if(!r.ok)throw Error(d.error);setRows(d.tickets);setAsOf(clock());setLoaded(true);setLoadError('');setLoadNote(d.truncated?'Latest 200 only. Filters cover loaded rows.':'Latest up to 200 tickets loaded.');return d.tickets as Ticket[];}
 async function readTimeline(id:string){try{const r=await fetch('/api/tickets?id='+id,{headers:await authHeaders()}),d=await r.json();if(!r.ok)throw Error(d.error);setTimeline(d);}catch{say('Could not load ticket timeline.',false);}}
 function open(t:Ticket){setActive(t.id);setTimeline(null);setNote('');setReply('');setMenuOpen(false);setMode(t.inbox_state==='taken_over'?'reply':'note');setTags(t.tags.join(', '));setEditTags(false);setShowAll(false);try{history.replaceState(null,'','?ticket='+t.id);}catch{}void readTimeline(t.id);}
 function close(){setActive(null);setTimeline(null);try{history.replaceState(null,'',location.pathname);}catch{}}

 useEffect(()=>{authHeaders().then(headers=>fetch(withBot('/api/tickets',botFilter),{headers})).then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);setRows(d.tickets);setAsOf(clock());setLoaded(true);setLoadNote(d.truncated?'Latest 200 only. Filters cover loaded rows.':'Latest up to 200 tickets loaded.');setPins(readPins());
  const requested=new URLSearchParams(location.search).get('ticket');const initial=d.tickets.find((t:Ticket)=>t.id===requested);
  if(initial){setActive(initial.id);setTags(initial.tags.join(', '));setMode(initial.inbox_state==='taken_over'?'reply':'note');authHeaders().then(headers=>fetch('/api/tickets?id='+initial.id,{headers})).then(r=>r.json()).then(x=>{if(x.error)throw Error(x.error);setTimeline(x);}).catch(()=>say('Could not load ticket timeline.',false));}
 }).catch(()=>{setLoaded(true);setLoadError('Please sign in or retry when the service recovers.');});},[botFilter]);

 /* While a taken-over conversation is open and the tab is visible, re-read its timeline so visitor
    replies from the widget appear without a manual refresh. */
 const liveId=rows.find(t=>t.id===active)?.inbox_state==='taken_over'?active:null;
 useEffect(()=>{if(!liveId)return;const tick=()=>{if(document.visibilityState==='visible'&&!busy)void authHeaders().then(headers=>fetch('/api/tickets?id='+liveId,{headers})).then(r=>r.ok?r.json():null).then(d=>{if(d&&!d.error)setTimeline(cur=>cur&&active===liveId?d:cur);}).catch(()=>{});};const id=window.setInterval(tick,POLL_MS);return()=>window.clearInterval(id);},[liveId,busy,active]);
 /* Close the header menu on any press outside it. */
 useEffect(()=>{if(!menuOpen)return;const away=(e:PointerEvent)=>{if(!(e.target as Element|null)?.closest?.('.ap-ib-more'))setMenuOpen(false);};document.addEventListener('pointerdown',away);return()=>document.removeEventListener('pointerdown',away);},[menuOpen]);
 function togglePin(id:string){const next=pins.includes(id)?pins.filter(x=>x!==id):[id,...pins];setPins(next);writePins(next);setMenuOpen(false);say(pins.includes(id)?'Conversation unpinned on this browser.':'Conversation pinned on this browser.',true);}
 async function act(body:unknown,after?:()=>void){setBusy(true);let ok=false;try{const r=await fetch('/api/tickets',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));ok=r.ok;say(d.note??d.error??(ok?'Saved.':'Update rejected.'),ok);const fresh=await load();if(ok){setSelected([]);after?.();if(active){const t=fresh.find(x=>x.id===active);if(t)setTags(t.tags.join(', '));await readTimeline(active);}}}catch{say('Outcome unconfirmed. Refresh before retrying.',false);}finally{setBusy(false);}return ok;}
 function refresh(){setBusy(true);load().then(()=>say('Tickets refreshed.',true)).catch(()=>say('Refresh failed.',false)).finally(()=>setBusy(false));}

 const viewDef=VIEWS.find(v=>v.key===view)!;
 const needle=search.toLowerCase();
 const visible=rows.filter(t=>viewDef.match(t)&&(status==='all'||t.ticket_status===status)&&(priority==='all'||t.priority===priority)&&(category==='all'||t.category===category)&&`${ticketLabel(t.id)} ${t.id} ${t.order_label} ${t.tags.join(' ')}`.toLowerCase().includes(needle)).sort((a,b)=>Number(pins.includes(b.id))-Number(pins.includes(a.id))||(sort==='oldest'?a.created_at.localeCompare(b.created_at):sort==='priority'?priorities.indexOf(b.priority)-priorities.indexOf(a.priority):b.ticket_updated_at.localeCompare(a.ticket_updated_at)));
 const filterCount=[status,priority,category].filter(x=>x!=='all').length;
 const current=rows.find(t=>t.id===active);
 const week=weekSummary(rows,asOf);
 const attentionCount=rows.filter(needsYou).length;

 function exportCsv(){const blob=new Blob([ticketCsv(visible)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=modeText('automatepal-fictional-tickets.csv','automatepal-tickets.csv');a.click();URL.revokeObjectURL(url);}
 function clearFilters(){setStatus('all');setPriority('all');setCategory('all');setSearch('');setView('all');}
 const focusNote=()=>document.getElementById('ap-ib-note')?.focus();

 /* Conversation: visitor questions and requests plus internal events, oldest first. */
 const items:Item[]=timeline?[
  ...timeline.events.map(e=>({id:e.id,created_at:e.created_at,label:words(e.kind),body:e.body,team:true})),
  ...timeline.requests.map(e=>({id:e.id,created_at:e.created_at,label:'Visitor request: '+words(e.kind),body:e.message+(e.contact_email?'\nFollow-up email (visitor consented): '+e.contact_email:'')+(timeline.payments??[]).filter(p=>p.requestId===e.id).map(paymentLine).join(''),team:false,chip:e.status==='pending_review'?'Pending review':cap(e.status)})),
  ...timeline.questions.map(e=>({id:e.id,created_at:e.created_at,label:`Visitor question · ${e.supported?'supported':'unanswered'}${e.feedback===-1?' · negative feedback':''}`,body:e.question,team:false,chip:e.supported?'Answered from sources':'No source found'})),
  ...(timeline.messages??[]).map(m=>({id:m.id,created_at:m.created_at,label:m.author==='owner'?'Reply in widget':'Visitor message',body:m.body,team:false,who:m.author})),
 ].sort((a,b)=>a.created_at.localeCompare(b.created_at)):[];
 const hidden=showAll?0:Math.max(0,items.length-8),shownItems=items.slice(hidden);

 const qs=timeline?.questions??[],unsupported=qs.filter(q=>!q.supported).length,negative=qs.filter(q=>q.feedback===-1).length,reqs=timeline?.requests??[],pendingReq=reqs.filter(r=>r.status==='pending_review').length;

 function nextStep(t:Ticket):{text:string;actions:Action[]}{
  const can=(s:string)=>!!transitions[t.ticket_status]?.includes(s);
  const setTo=(s:string)=>()=>void act({ids:[t.id],patch:{status:s}});
  const takeover=()=>void act({ids:[t.id],patch:{takeover:t.inbox_state!=='taken_over',status:'pending'}});
  const review=(decision:string)=>()=>void act({action:'review',id:t.id,decision});
  const resolve:Action[]=can('resolved')?[{label:'Mark resolved',icon:'check',primary:true,run:setTo('resolved')}]:[];
  if(t.ticket_status==='closed')return{text:'Closed. Reopen it if the visitor comes back. Reopening does not extend the demo link.',actions:can('open')?[{label:'Reopen ticket',primary:true,run:setTo('open')}]:[]};
  if(t.ticket_status==='resolved')return{text:'Resolved. Save the answer as reusable Q&A, then close the ticket.',actions:[{label:'Prepare Q&A',icon:'note',primary:true,run:()=>document.getElementById('ap-ib-qa-q')?.focus()},...(can('closed')?[{label:'Close ticket',run:setTo('closed')}]:[])]};
  if(t.category==='refund'&&t.review_decision==='pending')return{text:'An owner refund review is pending. Record the decision. Approval is not a refund and moves no money.',actions:[{label:'Record approved review',primary:true,run:review('approved')},{label:'Record rejected review',run:review('rejected')}]};
  if(t.category==='refund'&&!t.review_decision)return{text:'Refund question. Request an owner review before anyone replies.',actions:[{label:'Request owner review',primary:true,run:review('pending')}]};
  if(t.inbox_state==='taken_over')return{text:'AI is paused, so this ticket waits on a person. Resolve it once the visitor is sorted, then release AI.',actions:[...resolve,{label:'Release AI',icon:'bot',run:takeover}]};
  if(t.category==='handoff')return{text:'The visitor asked for a person. Take over to pause AI, then follow up.',actions:[{label:'Take over / pause AI',icon:'pause',primary:true,run:takeover}]};
  if(unsupported>0)return{text:`${unsupported} visitor question${unsupported>1?'s':''} had no source. Add the answer to Knowledge so the next visitor gets one.`,actions:[{label:'Open Knowledge',primary:true,href:'/knowledge'}]};
  if(t.ticket_status==='new')return{text:'New ticket. Open it to start work.',actions:can('open')?[{label:'Open ticket',primary:true,run:setTo('open')}]:[]};
  if(!t.assigned_to_owner)return{text:'Nobody owns this ticket yet. Assign it to the owner.',actions:[{label:'Assign to owner',icon:'userPlus',primary:true,run:()=>void act({ids:[t.id],patch:{assigned:true}})}]};
  return{text:'Nothing is blocking. Resolve it once the visitor is sorted.',actions:resolve};
 }

 function detail(t:Ticket){
  const st=statusMeta(t.ticket_status),step=nextStep(t),paused=aiPaused(t);
  /* Refund review buttons live in the next step when it offers them, otherwise on the check row. */
  const stepReview=step.actions.some(a=>/review/i.test(a.label));
  const exp=t.expires_at?Date.parse(t.expires_at):NaN,created=Date.parse(t.created_at),expired=!Number.isNaN(exp)&&exp<=asOf;
  const linkPct=Number.isNaN(exp)?0:Math.min(100,Math.max(0,100*(asOf-created)/Math.max(1,exp-created)));
  const statusOpts=withCurrent(statuses,t.ticket_status).filter(v=>v===t.ticket_status||transitions[t.ticket_status]?.includes(v));
  const patch=(p:Record<string,unknown>)=>void act({ids:[t.id],patch:p});
  return <>
   <header className="ap-ib-dhead">
    <button type="button" className="ap-ib-back" onClick={close}><I n="chevronLeft" s={15}/>All tickets</button>
    <Participants t={t}/>
    <span className="ap-ib-did" title={'Full ticket ID: '+t.id}>{ticketLabel(t.id)}</span>
    <div className="ap-ib-dhead-r">
     <button type="button" disabled={busy} className={'ap-ib-btn'+(t.inbox_state==='taken_over'?' pink':'')} onClick={()=>patch({takeover:t.inbox_state!=='taken_over',status:'pending'})}><I n={t.inbox_state==='taken_over'?'bot':'pause'} s={14}/>{t.inbox_state==='taken_over'?'Release AI':'Take over'}</button>
     <button type="button" disabled={busy} className="ap-ib-btn" onClick={()=>patch({assigned:!t.assigned_to_owner})}><I n={t.assigned_to_owner?'userX':'userPlus'} s={14}/>{t.assigned_to_owner?'Unassign':'Assign to owner'}</button>
     <button type="button" className="ap-ib-icon" aria-label="Copy ticket link" title="Copy ticket link" onClick={()=>{navigator.clipboard?.writeText(location.origin+'/tickets?ticket='+t.id).then(()=>say('Ticket link copied.',true),()=>say('Copy failed. Use the address bar.',false));}}><I n="share" s={14}/></button>
     <div className="ap-ib-more" onKeyDown={e=>{if(!menuOpen)return;const items=[...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')],i=items.indexOf(document.activeElement as HTMLElement);if(e.key==='Escape'){e.stopPropagation();setMenuOpen(false);e.currentTarget.querySelector<HTMLButtonElement>('button')?.focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}>
      <button type="button" className={'ap-ib-icon'+(menuOpen?' on':'')} aria-label="More actions" title="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={()=>{setMenuOpen(!menuOpen);if(!menuOpen)window.setTimeout(()=>document.querySelector<HTMLElement>('.ap-ib-menu [role=menuitem]')?.focus(),0);}}><I n="more" s={15}/></button>
      {menuOpen&&<div className="ap-ib-menu" role="menu" aria-label="More actions">
       <button type="button" role="menuitem" onClick={()=>togglePin(t.id)}><I n="pin" s={14}/>{pins.includes(t.id)?'Unpin conversation':'Pin conversation'}</button>
       <button type="button" role="menuitem" onClick={()=>{setMenuOpen(false);setMode('note');window.setTimeout(focusNote,0);}}><I n="note" s={14}/>Write an internal note</button>
       <Link role="menuitem" href="/support" onClick={()=>setMenuOpen(false)}><I n="settings" s={14}/>Working hours and widget</Link>
      </div>}
     </div>
    </div>
   </header>

   <div className="ap-ib-dbody">
    <h2 className="ap-ib-title">{t.order_label}</h2>
    <div className="ap-ib-chips">
     <label className="ap-ib-chip"><span className="ap-ib-dot" style={{background:st.dot}}/><select aria-label="Ticket Status" disabled={busy} value={t.ticket_status} onChange={e=>patch({status:e.target.value})}>{statusOpts.map(v=><option key={v} value={v}>{statusMeta(v).label}</option>)}</select><I n="chevronDown" s={12}/></label>
     <label className="ap-ib-chip"><select aria-label="Ticket Category" disabled={busy} value={t.category} onChange={e=>patch({category:e.target.value})}>{withCurrent(categories,t.category).map(v=><option key={v} value={v}>{cap(v)}</option>)}</select><I n="chevronDown" s={12}/></label>
     <label className="ap-ib-chip"><span className="ap-ib-bar" style={{background:PRIORITY_COLOR[t.priority]??'#C2D1F2'}}/><select aria-label="Ticket Priority" disabled={busy} value={t.priority} onChange={e=>patch({priority:e.target.value})}>{withCurrent(priorities,t.priority).map(v=><option key={v} value={v}>{cap(v)}</option>)}</select><I n="chevronDown" s={12}/></label>
     <span className="ap-ib-created">Created {whenLabel(t.created_at,asOf)} via widget</span>
     <span className={'ap-ib-ai'+(paused?' off':'')}><I n={paused?'pause':'bot'} s={13}/>AI {paused?'paused':'available'}</span>
    </div>

    <dl className="ap-ib-props">
     <dt>Assignee</dt>
     <dd><label className="ap-ib-inline"><span className={'ap-ib-av'+(t.assigned_to_owner?'':' none')}>{t.assigned_to_owner?'OW':''}</span><select aria-label="Ticket assignee" disabled={busy} value={t.assigned_to_owner?'owner':'unassigned'} onChange={e=>patch({assigned:e.target.value==='owner'})}><option value="unassigned">Unassigned</option><option value="owner">Workspace owner</option></select><I n="chevronDown" s={12}/></label></dd>
     <dt>Service</dt>
     <dd>{cap(t.ticket_type??'question')} · {t.assignment_queue||'general'} queue{typeof t.impact==='number'&&typeof t.urgency==='number'?` · impact ${t.impact} / urgency ${t.urgency}`:''}</dd>
     <dt>Tags</dt>
     <dd>{editTags?<div className="ap-ib-tagedit">
       <input aria-label="Tags, comma-separated (max 8, letters/numbers/_/-)" value={tags} onChange={e=>setTags(e.target.value)} maxLength={210} placeholder="refund, vip"/>
       <button type="button" disabled={busy} className="ap-ib-btn primary sm" onClick={()=>void act({ids:[t.id],patch:{tags:tags.split(',').map(x=>x.trim()).filter(Boolean)}},()=>setEditTags(false))}>Save tags</button>
       <button type="button" className="ap-ib-btn sm" onClick={()=>{setTags(t.tags.join(', '));setEditTags(false);}}>Cancel</button>
       <span className="ap-ib-hint">Max 8, letters, numbers, _ or -</span>
      </div>:<div className="ap-ib-tags">{t.tags.length?t.tags.map(x=><span key={x} className="ap-ib-tag">{x}</span>):<span className="ap-ib-faint">No tags</span>}<button type="button" className="ap-ib-textbtn" onClick={()=>setEditTags(true)}>Edit</button></div>}</dd>
     <dt>Timing</dt>
     <dd className="ap-ib-timers">
      <div><p><b>{ageLabel(t.created_at,asOf)}</b> old</p><small>{t.first_reviewed_at?'First owner review after '+ageLabel(t.created_at,Date.parse(t.first_reviewed_at)):'Awaiting first owner review'}</small></div>
      <div><p className={expired?'late':''}><b>{Number.isNaN(exp)?'No':expired?'Expired':fmtDur(exp-asOf)}</b> {Number.isNaN(exp)?'expiry':expired?'':'left'}</p><span className="ap-ib-track"><i style={{width:linkPct+'%',background:expired?'#E25FAE':'#041A52'}}/></span><small>{Number.isNaN(exp)?'Demo link has no expiry':'Demo link '+(expired?'expired ':'expires ')+new Date(exp).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></div>
     </dd>
    </dl>

    <section className="ap-ib-card" aria-label="Ticket check">
     <header><span className="ap-ib-card-ic"><I n="clipboard" s={14}/></span><h3>Ticket check</h3><span className="ap-ib-card-via">{timeline?'From this workspace':<><span className="ap-ib-spin"/>Checking</>}</span></header>
     <ul className="ap-ib-checks">
      {t.first_reviewed_at?<Check state="done" text={'First owner review after '+ageLabel(t.created_at,Date.parse(t.first_reviewed_at))} status="Done"/>:<Check state="wait" text={'Awaiting first owner review · '+ageLabel(t.created_at,asOf)} status="Waiting"/>}
      {!timeline?<Check state="run" text="Checking visitor questions" status="Running now"/>:!qs.length?<Check state="done" text="No visitor questions recorded" status="Clear"/>:unsupported?<Check state="todo" text={`${unsupported} of ${qs.length} question${qs.length>1?'s':''} had no source`} status="Needs review"/>:<Check state="done" text={`${qs.length} question${qs.length>1?'s':''} answered from sources`} status="Done"/>}
      {timeline&&negative>0&&<Check state="todo" text={`Negative feedback on ${negative} answer${negative>1?'s':''}`} status="Needs review"/>}
      {timeline&&reqs.length>0&&(pendingReq?<Check state="todo" text={`${pendingReq} visitor request${pendingReq>1?'s':''} pending review`} status="Needs review"/>:<Check state="done" text={`${reqs.length} visitor request${reqs.length>1?'s':''} handled`} status="Done"/>)}
      {t.category==='refund'&&(t.review_decision==='pending'
       ?<Check state="todo" text="Owner refund review pending" status="Needs decision" extra={!stepReview&&<span className="ap-ib-chk-x">{(['approved','rejected'] as const).map(d=><button key={d} type="button" disabled={busy} className="ap-ib-textbtn" onClick={()=>void act({action:'review',id:t.id,decision:d})}>{d==='approved'?'Record approved review':'Record rejected review'}</button>)}</span>}/>
       :<Check state={t.review_decision?'done':'wait'} text={t.review_decision?'Refund review recorded: '+words(t.review_decision):'Owner refund review not requested'} status={t.review_decision?'Done':'Not started'} extra={!stepReview&&<span className="ap-ib-chk-x"><button type="button" disabled={busy} className="ap-ib-textbtn" onClick={()=>void act({action:'review',id:t.id,decision:'pending'})}>Request owner review</button></span>}/>)}
      {expired&&<Check state="todo" text="Demo link expired" status="Expired"/>}
     </ul>
     <div className="ap-ib-step">
      <p className="ap-ib-step-k">Next step</p>
      <p className="ap-ib-step-t">{step.text}</p>
      <div className="ap-ib-step-a">
       {step.actions.map(a=>a.href?<Link key={a.label} href={a.href} className={'ap-ib-btn'+(a.primary?' primary':'')}>{a.icon&&<I n={a.icon} s={14}/>}{a.label}</Link>:<button key={a.label} type="button" disabled={busy} onClick={a.run} className={'ap-ib-btn'+(a.primary?' primary':'')}>{a.icon&&<I n={a.icon} s={14}/>}{a.label}</button>)}
       <button type="button" className="ap-ib-btn" onClick={focusNote}><I n="note" s={14}/>Add internal note</button>
      </div>
     </div>
    </section>

    {!isOpenTicket(t)&&<QaDraft key={'qa'+t.id}/>}

    <section className="ap-ib-svcbox" aria-label="Service record fields">
     <header><h3>Service record</h3><small>{cap(t.ticket_type??'question')} · {t.assignment_queue||'general'} queue</small></header>
     <ServiceFields key={t.id+t.ticket_updated_at} ticket={t} rows={rows} busy={busy} act={act}/>
    </section>

    <section className="ap-ib-thread" aria-label="Activity stream (internal work notes)">
     <header><h3><I n="message" s={14}/>Conversation &amp; activity</h3>{hidden>0&&<button type="button" className="ap-ib-textbtn" onClick={()=>setShowAll(true)}>Show {hidden} earlier</button>}</header>
     <p className="ap-ib-note">{timeline?.coverage??'Loading...'}</p>
     {timeline&&!items.length&&<p className="ap-ib-faint">Nothing recorded on this ticket yet.</p>}
     <ol className="ap-ib-msgs">{shownItems.map((e,i)=><li key={e.id+'-'+i} className={'ap-ib-msg'+(e.team?' team':'')+(e.who==='owner'?' owner':'')+(e.chip==='No source found'||e.chip==='Pending review'?' flag':'')}>
      {e.team?<span className="ap-ib-msg-av" aria-hidden="true"><I n="note" s={13}/></span>:<Avatar who={e.who==='owner'?'owner':'visitor'} size={26}/>}
      <div className="ap-ib-msg-b">
       <p className="ap-ib-msg-meta">{e.team?'Internal · ':''}{e.label} · <time dateTime={e.created_at} title={new Date(e.created_at).toISOString()}>{whenLabel(e.created_at,asOf)}</time></p>
       <p className="ap-ib-msg-text">{e.body}</p>
       {e.chip&&<span className="ap-ib-msg-chip">{e.chip}</span>}
      </div>
     </li>)}</ol>
    </section>
    <p className="ap-ib-foot">Full ticket ID: {t.id}. Resolved/closed also pause AI. Reopening does not extend the demo link. First owner review is not a customer-response or SLA metric. Widget replies appear in the visitor&apos;s widget. A reply is also emailed only when you tick “Also email this reply” and the visitor gave an address with consent.</p>
   </div>

   <form className={'ap-ib-compose'+(mode==='reply'?' is-reply':'')} onSubmit={e=>{e.preventDefault();if(mode==='reply'){if(t.inbox_state==='taken_over'&&reply.trim())void act({action:'reply',id:t.id,body:reply,...(emailVisitor?{emailVisitor:true}:{})},()=>{setReply('');setEmailVisitor(false);});}else if(note.trim())void act({action:'note',id:t.id,body:note},()=>setNote(''));}}>
    <div className="ap-ib-compose-top">
     <div className="ap-ib-tabs" role="tablist" aria-label="Message type">
      <button type="button" role="tab" aria-selected={mode==='note'} onClick={()=>setMode('note')}><I n="note" s={11}/>Internal note</button>
      <button type="button" role="tab" aria-selected={mode==='reply'} onClick={()=>setMode('reply')}><I n="message" s={11}/>Reply in widget</button>
     </div>
     {paused&&<span className="ap-ib-compose-state"><I n="pause" s={11}/>{t.inbox_state==='taken_over'?'Taken over · AI paused':'AI paused'}</span>}
    </div>
    {mode==='note'?<div className="ap-ib-compose-row">
     <textarea id="ap-ib-note" aria-label="Internal note" value={note} maxLength={2000} rows={2} onChange={e=>setNote(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder={modeText('Write an internal note. Fictional details only, no secrets or customer information.','Write an internal note. No secrets or payment details.')}/>
     <button type="submit" className="ap-ib-send" aria-label="Save internal note" title="Save internal note (Ctrl/⌘ + Enter)" disabled={busy||!note.trim()}><I n="arrowUp" s={15} sw={2.4}/></button>
    </div>:t.inbox_state==='taken_over'?<>
     <div className="ap-ib-compose-row">
      <textarea id="ap-ib-reply" aria-label="Reply to the visitor in the widget" aria-describedby="ap-ib-reply-hint" value={reply} maxLength={MESSAGE_MAX} rows={2} onChange={e=>setReply(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder={modeText('Write to the visitor. Fictional details only.','Write to the visitor.')}/>
      <button type="submit" className="ap-ib-send pink" aria-label="Send reply in widget" title="Send reply in widget (Ctrl/⌘ + Enter)" disabled={busy||!reply.trim()||expired}><I n="send" s={14} sw={2.2}/></button>
     </div>
     <p className="ap-ib-compose-hint" id="ap-ib-reply-hint">{expired?'The demo link has expired, so the visitor can no longer see replies.':emailVisitor?"Shown live in the visitor's widget, and emailed only if the visitor left an address with consent.":"Shown live in the visitor's widget only. Nothing is emailed."}<span aria-live="polite">{reply.length}/{MESSAGE_MAX}</span></p>
     <label className="ap-ib-compose-hint" style={{justifyContent:'flex-start',gap:8}}><input type="checkbox" checked={emailVisitor} onChange={e=>setEmailVisitor(e.target.checked)}/>Also email this reply to the visitor (only to an address they gave with consent; only your reply text is sent)</label>
    </>:<div className="ap-ib-compose-lock">
     <p>Take over to reply in the widget.</p>
     <button type="button" disabled={busy||t.inbox_state==='closed'} className="ap-ib-btn primary sm" onClick={()=>void act({ids:[t.id],patch:{takeover:true,status:'pending'}},()=>setMode('reply'))}><I n="pause" s={13}/>Take over and reply</button>
    </div>}
   </form>
  </>;
 }

 const allShownSelected=visible.length>0&&visible.slice(0,50).every(t=>selected.includes(t.id));

 return <DeskShell widget><DashShell crumb="Tickets" notifications={buildNotifs(rows)}>
 <main className={'ap-ib'+(current?' has-active':'')}>
  <h1 className="ap-ib-sr">Tickets</h1>
  <div className="ap-ib-left">
   <nav className="ap-ib-rail" aria-label="Ticket views">
    <div className="ap-ib-rail-head"><b>Support inbox</b><span>{loaded&&!loadError?`${rows.length} loaded`:modeText('Fictional workspace','Your workspace')}</span></div>
    <div className="ap-ib-pills">
     <button type="button" className={'ap-ib-pillbtn'+(searchOpen||search?' on':'')} aria-expanded={searchOpen||!!search} aria-controls="ap-ib-search" onClick={()=>{const next=!(searchOpen||!!search);setSearchOpen(next);if(!next)setSearch('');else window.setTimeout(()=>document.getElementById('ap-ib-search')?.focus(),0);}}><I n="search" s={13}/>Search</button>
     <button type="button" className={'ap-ib-pillbtn'+(filtersOpen||filterCount?' on':'')} aria-expanded={filtersOpen} aria-controls="ap-ib-filters" onClick={()=>setFiltersOpen(!filtersOpen)}><I n="filter" s={13}/>Filter{filterCount>0&&<span className="ap-ib-pillbtn-n">{filterCount}</span>}</button>
     <Link href="/setup" className="ap-ib-pillbtn primary" aria-label={modeText('New fictional demo chat','New test chat')} title={modeText('New fictional demo chat','New test chat')}><I n="plus" s={14} sw={2.4}/></Link>
    </div>
    <label className={'ap-ib-search'+(searchOpen||search?' is-open':'')}><I n="search" s={14}/><input id="ap-ib-search" type="search" aria-label="Search ticket, fixture or tag" placeholder="Search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={160}/></label>
    <div className="ap-ib-rail-views">{(['Inbox','Queues'] as const).map(g=><div key={g} className="ap-ib-rail-group">
     <p className="ap-ib-rail-k">{g}</p>
     {VIEWS.filter(v=>v.group===g).map(v=>{const n=rows.filter(v.match).length;return <button key={v.key} type="button" aria-pressed={view===v.key} className={v.key==='attention'&&n>0?'hot':''} onClick={()=>{setView(v.key);setSelected([]);}}><I n={v.icon} s={15}/><span className="ap-ib-rail-l">{v.label}</span>{loaded&&<span className="ap-ib-rail-n">{n}</span>}</button>;})}
    </div>)}</div>
    <div className="ap-ib-rail-foot">
     <Link href="/contact"><I n="lifebuoy" s={15}/>Support</Link>
     <Link href="/support"><I n="settings" s={15}/>Settings</Link>
    </div>
   </nav>

   <section className="ap-ib-list" aria-label="Ticket list">
    <header className="ap-ib-lhead">
     <h2>{viewDef.label}</h2>
     <BotFilter/>
     <label className="ap-ib-sort"><select aria-label="Sort tickets" value={sort} onChange={e=>setSort(e.target.value)}>{SORTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><I n="chevronDown" s={12}/></label>
     <button type="button" className={'ap-ib-icon'+(filtersOpen||filterCount?' on':'')} aria-label={'Filters'+(filterCount?` (${filterCount} active)`:'')} aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(!filtersOpen)}><I n="filter" s={14}/>{filterCount>0&&<span className="ap-ib-badge">{filterCount}</span>}</button>
     <button type="button" className="ap-ib-icon" aria-label="Refresh tickets" title="Refresh tickets" disabled={busy} onClick={refresh}><I n="refresh" s={14}/></button>
    </header>

    {filtersOpen&&<div className="ap-ib-filters" id="ap-ib-filters">
     {([['Status',status,setStatus,statuses],['Priority',priority,setPriority,priorities],['Category',category,setCategory,categories]] as const).map(([label,value,set,choices])=><label key={label} className="ap-ib-field">{label}<select value={value} onChange={e=>set(e.target.value)}><option value="all">All</option>{choices.map(v=><option key={v} value={v}>{cap(v)}</option>)}</select></label>)}
     <div className="ap-ib-filters-a"><button type="button" className="ap-ib-btn sm" onClick={exportCsv}><I n="download" s={13}/>Export filtered CSV</button>{(filterCount>0||view!=='all'||search)&&<button type="button" className="ap-ib-textbtn" onClick={clearFilters}>Clear all</button>}</div>
     <p className="ap-ib-note">{visible.length} shown · loaded rows only, no notes or contacts in CSV</p>
    </div>}


    <div className="ap-ib-scroll">
     {loaded&&rows.length>0&&<div className="ap-ib-week">
      <p className="ap-ib-week-k">{week.thisWeek?'This week':'Loaded tickets'}</p>
      <p className="ap-ib-week-t"><b>{week.resolved}</b> of {week.total} ticket{week.total===1?'':'s'} resolved or closed, <b>{week.attention}</b> need{week.attention===1?'s':''} you.{week.median!=null&&<> Median first owner review after <b>{fmtDur(week.median)}</b>.</>}</p>
      <div className="ap-ib-seg" aria-hidden="true">{week.resolved>0&&<i style={{flex:week.resolved,background:'#041A52'}}/>}{week.attention>0&&<i style={{flex:week.attention,background:'#FD91CC'}}/>}{week.open>0&&<i style={{flex:week.open,background:'#C2D1F2'}}/>}</div>
      <p className="ap-ib-legend"><span><i style={{background:'#041A52'}}/>Resolved {week.resolved}</span><span><i style={{background:'#FD91CC'}}/>Needs you {week.attention}</span><span><i style={{background:'#C2D1F2'}}/>Open {week.open}</span></p>
     </div>}

     {!loaded&&<ul className="ap-ib-items" aria-label="Loading tickets">{[0,1,2,3].map(i=><li key={i} className="ap-ib-skel"><i/><i/><i/></li>)}</ul>}
     {loadError&&<div className="ap-ib-empty"><p>{loadError}</p><button type="button" className="ap-ib-btn sm" disabled={busy} onClick={refresh}><I n="refresh" s={13}/>Retry</button></div>}
     {loaded&&!loadError&&!rows.length&&<div className="ap-ib-empty"><p>No tickets yet.</p><Link href="/setup" className="ap-ib-link">{modeText('Create a fictional demo in Quick setup','Create a test chat in Quick setup')}</Link></div>}
     {loaded&&rows.length>0&&!visible.length&&<div className="ap-ib-empty"><p>No loaded tickets match this view.</p><button type="button" className="ap-ib-textbtn" onClick={clearFilters}>Clear filters</button></div>}

     {visible.length>0&&<div className={'ap-ib-bulkbar'+(selected.length?' on':'')}>
      <label className="ap-ib-checkrow"><input type="checkbox" aria-label="Select first 50 shown" checked={allShownSelected} onChange={e=>setSelected(e.target.checked?visible.slice(0,50).map(t=>t.id):[])}/>{selected.length?`${selected.length} selected`:`${visible.length} ticket${visible.length===1?'':'s'}`}</label>
      {selected.length>0&&<>
       <select aria-label="Bulk status" value={bulk} onChange={e=>setBulk(e.target.value)}>{statuses.map(s=><option key={s} value={s}>{statusMeta(s).label}</option>)}</select>
       <button type="button" disabled={busy} onClick={()=>void act({ids:selected,patch:{status:bulk}})} className="ap-ib-btn primary sm">Apply to {selected.length} selected</button>
       <button type="button" className="ap-ib-icon" aria-label="Clear selection" onClick={()=>setSelected([])}><I n="x" s={14}/></button>
      </>}
     </div>}
     {visible.length>0&&<ul className={'ap-ib-items'+(selected.length?' has-sel':'')}>{visible.map(t=>{const st=statusMeta(t.ticket_status),on=active===t.id,pinned=pins.includes(t.id);return <li key={t.id} className={'ap-ib-item'+(on?' on':'')+(pinned?' pinned':'')} style={{'--stripe':PRIORITY_COLOR[t.priority]??'#C2D1F2'} as React.CSSProperties}>
      {<input type="checkbox" className="ap-ib-check" aria-label={'Select '+ticketLabel(t.id)} checked={selected.includes(t.id)} onChange={e=>setSelected(e.target.checked?[...selected,t.id].slice(0,50):selected.filter(id=>id!==t.id))}/>}
      <button type="button" className="ap-ib-item-b" aria-current={on?'true':undefined} aria-label={ticketLabel(t.id)} aria-describedby={'ib-t-'+t.id+' ib-p-'+t.id+' ib-m-'+t.id} onClick={()=>open(t)}>
       <Avatar who={handler(t)} size={32}/>
       <span className="ap-ib-item-main">
        <span className="ap-ib-item-top"><span className="ap-ib-item-title" id={'ib-t-'+t.id}>{t.order_label}</span><span className="ap-ib-item-time">{pinned&&<span className="ap-ib-item-pin" title="Pinned on this browser"><I n="pin" s={11}/><span className="ap-ib-sr">Pinned</span></span>}{shortAgo(t.ticket_updated_at,asOf)}</span></span>
        <span className="ap-ib-item-prev" id={'ib-p-'+t.id}>{rowPreview(t)}</span>
        <span className="ap-ib-item-meta" id={'ib-m-'+t.id}>
         <span className="ap-ib-item-id">{ticketLabel(t.id)}</span>
         <span className="ap-ib-item-who">{t.assigned_to_owner?'Owner':'Unassigned'} · {cap(t.category)}</span>
         {t.inbox_state==='taken_over'?<span className="ap-ib-pill navy"><I n="pause" s={11}/>AI paused</span>:needsYou(t)?<span className="ap-ib-pill pink">Needs you</span>:<span className="ap-ib-state"><span className="ap-ib-dot" style={{background:st.dot}}/>{words(t.ticket_status)}</span>}
        </span>
       </span>
      </button>
     </li>;})}</ul>}
     {loaded&&!loadError&&rows.length>0&&<p className="ap-ib-loadnote">{loadNote}</p>}
    </div>
   </section>
  </div>

  <section className="ap-ib-detail" aria-label="Ticket details">
   {current?<div key={current.id} className="ap-ib-dwrap">{detail(current)}</div>:<div className="ap-ib-pick">
    <MascotCluster/>
    <h2>Pick a conversation</h2>
    <p>The AI assistant, you and the visitor meet here. Take over to reply in the widget; notes stay internal.</p>
    {attentionCount>0&&view!=='attention'&&<button type="button" className="ap-ib-btn" onClick={()=>setView('attention')}><I n="alert" s={14}/>Show the {attentionCount} that need you</button>}
   </div>}
  </section>

  <div className="ap-ib-toast" role="status" aria-live="polite">{toast&&<span key={toast.n} className={toast.ok?'ok':'err'}><I n={toast.ok?'check':'alert'} s={15}/>{toast.text}</span>}</div>
 </main>
 </DashShell></DeskShell>;
}
