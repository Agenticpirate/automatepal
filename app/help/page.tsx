"use client";
/* The visitor's chat panel (the widget frame and the hosted chat page). A conversation: the visitor's questions and
   the answers stack in a scrolling thread, the composer stays at the bottom, and the less common requests (refund
   review, receipt, a follow-up by email) sit in a section that opens when needed. */
import {useEffect,useRef,useState} from 'react';
import './help.css';
import {modeText} from '../../lib/app-mode';
import DeskShell from '../components/DeskShell';
import BillingCard from './components/BillingCard';
import type {BillingPreview} from '../../lib/billing-preview';
import BillingRecordCard from './components/BillingRecordCard';
import BillingVerify,{type BillingSupport} from './components/BillingVerify';
import {INTENT_LABELS,INTENT_QUESTIONS} from '../../lib/billing/core/intent';
import type {BillingCard as BillingRecord} from '../../lib/billing/core/types';
import PersonChat,{useCaseThread} from './components/PersonChat';
import {isOpenNow,workingHours,DEFAULT_AWAY_MESSAGE} from '../../lib/working-hours';
import {PROMPT_INJECTION_REFUSAL,promptInjection} from '../../lib/prompt-guard';
import {followUpsFor} from '../../lib/follow-ups';
import {embedOrigin,postHelpEvent} from '../../lib/widget-events';
import {resolveLang,widgetText} from '../../lib/widget-i18n';
import {startersFor} from '../../lib/widget';
type Case={billingSupport?:BillingSupport|null;billing?:BillingPreview|null;inboxState?:string;order:string;amount:number;currency:string;status:string;source?:'demo'|'widget';branding?:{label:string;color:string;initials:string;prompts:string[];logoVersion?:number|null};expiresAt?:string;controls?:{hideSources?:boolean;hideOrder?:boolean;hideContact?:boolean;hideRating?:boolean;visitorChoice?:boolean;workingHours?:unknown;followUps?:unknown;language?:string;pageStarters?:{path:string;prompts:string[]}[]}};
type Answer={interactionId?:string;answerKind?:'owner_exact_response'|'billing_record'|'billing_verification_required';supported?:boolean;answer:string;billing?:{cards:BillingRecord[];lookupId:string;mode:'test'|'live';provider:string};sources:{id:string;title:string;sourceKind?:'text'|'owner_guidance'|'billing_record';quotes?:string[]}[]};
type Turn={id:number;q:string;a:Answer|null;rated?:1|-1};
/* The thread survives a reload of the panel in this browser tab. Billing records are left out: they are shown
   only for the 30 minutes a payment check lasts and are not written to storage. */
const threadKey=(token:string)=>'ap-thread-'+token.slice(0,16);
function loadTurns(token:string):Turn[]{try{const v=JSON.parse(sessionStorage.getItem(threadKey(token))??'[]');return Array.isArray(v)?v.filter(t=>t&&typeof t.q==='string'&&t.a&&typeof t.a.answer==='string'&&Array.isArray(t.a.sources)).slice(-20):[];}catch{return [];}}
function saveTurns(token:string,turns:Turn[]){try{sessionStorage.setItem(threadKey(token),JSON.stringify(turns.filter(t=>t.a&&!t.a.billing&&t.a.answerKind!=='billing_record').slice(-20)));}catch{/* storage blocked: the thread lasts until reload */}}
export default function Help(){
 const [page,setPage]=useState<string|null>(null),[token,setToken]=useState(''),[embed,setEmbed]=useState<string|null>(null),[item,setItem]=useState<Case|null>(null),[hours,setHours]=useState<{open:boolean;away:string}>({open:true,away:DEFAULT_AWAY_MESSAGE}),[kind,setKind]=useState('billing_question'),[message,setMessage]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[consent,setConsent]=useState(false),[rated,setRated]=useState(0),[turns,setTurns]=useState<Turn[]>([]),[more,setMore]=useState(false);
 const threadRef=useRef<HTMLDivElement>(null),nextId=useRef(1),wantEmail=useRef(false);
 /* The one-time URL parameters are read once, when this component is created (before the effect strips them
    from the address bar), so React's development double run of the effect reuses the same values. */
 const [init]=useState(()=>{if(typeof window==='undefined')return{token:'',parent:null as string|null,page:null as string|null};const q=new URLSearchParams(location.search),pg=q.get('page');return{token:q.get('token')??'',parent:embedOrigin(q.get('embed')),page:pg&&pg.length<=200&&/^\/(?!\/)[^?#]*$/.test(pg)?pg:null};});
 useEffect(()=>{const token=init.token,parent=init.parent,validPage=init.page;history.replaceState(null,'','/help');Promise.resolve(token).then(t=>{setToken(t);setEmbed(parent);setPage(validPage);const saved=loadTurns(t);nextId.current=saved.reduce((n,x)=>Math.max(n,x.id),0)+1;setTurns(saved);});fetch('/api/support?token='+encodeURIComponent(token)).then(r=>r.json()).then(d=>{if(d.error)setStatus(d.error);else{setItem(d.case);/* Counts one open for the engagement funnel (no visitor text). */void fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open',token,source:parent?'widget':'hosted_page'})}).catch(()=>{});const h=workingHours.safeParse(d.case?.controls?.workingHours);if(h.success)setHours({open:isOpenNow(h.data),away:h.data.awayMessage||DEFAULT_AWAY_MESSAGE});}}).catch(()=>setStatus(modeText('Demo unavailable.','Chat unavailable.')));},[init]);
 /* Live inbox state and the person thread. Polls while the page is visible; the polled state wins. */
 const thread=useCaseThread(token,!!item,item?.expiresAt);const inbox=thread.inboxState??item?.inboxState;
 const paused=inbox==='taken_over'||inbox==='closed';
 const accent=item?.branding?.color??'#233de8';const rgb=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);const foreground=rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722>0.179?'#111111':'#ffffff';
 /* Fixed interface text in the owner's chosen language, or the visitor's browser language (lib/widget-i18n.ts). */
 const lang=resolveLang(item?.controls?.language,typeof navigator==='undefined'?[]:navigator.languages),tx=widgetText(lang);
 useEffect(()=>{if(item)document.documentElement.lang=lang;},[item,lang]);
 /* New turns, person messages and the waiting state scroll the thread to its end. */
 useEffect(()=>{const el=threadRef.current;if(el&&(turns.length||thread.messages.length))el.scrollTop=el.scrollHeight;},[turns,thread.messages.length,inbox,busy]);
 const update=(next:Turn[])=>{setTurns(next);if(token)saveTurns(token,next);};
 async function feedback(turn:Turn,value:1|-1){if(!turn.a?.interactionId)return;const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'feedback',token,id:turn.a.interactionId,feedback:value})});if(r.ok)update(turns.map(t=>t.id===turn.id?{...t,rated:value}:t));setStatus(r.ok?'Feedback recorded.':'Could not record feedback.');}
 /* CSAT (db/065): one 1 to 5 rating for the conversation; choosing again replaces it. */
 async function rate(score:number){const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rate',token,score})}).catch(()=>null);if(r?.ok){setRated(score);setStatus(tx.rateThanks);}else setStatus(tx.unavailable);}
 async function ask(q?:string){
  const question=(q??message).trim();if(busy||question.length<3||paused)return;
  /* Prompt-injection guard: refuse before sending and keep the text in the box. The server checks again. */
  if(promptInjection(question)){setStatus(PROMPT_INJECTION_REFUSAL);return;}
  const id=nextId.current++,before=turns;
  setBusy(true);setStatus('Checking published sources...');setTurns([...before,{id,q:question,a:null}]);
  try{
   const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'answer',token,question,source:embed?'widget':'hosted_page'})});const d=await r.json();
   if(!r.ok){setTurns(before);setMessage(question);setStatus(d.error);return;}
   update([...before,{id,q:question,a:d}]);setMessage('');setStatus('Source check finished. No payment action taken.');postHelpEvent(embed,{event:'message_sent',channel:'ai'});
  }catch{setTurns(before);setMessage(question);setStatus('Could not check sources. Ask a person to review.');}finally{setBusy(false);}
 }
 async function send(){
  if(message.trim().length<5){setStatus(tx.yourQuestion);document.getElementById('help-message')?.focus();return;}
  if(email&&!consent){setStatus(modeText('Allow this demo owner to see the address for this request. The owner may reply to it by email; nothing is sent to it automatically.',tx.consent));return;}
  setBusy(true);
  try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',token,kind,message,...(email?{email}:{}),consent})});const d=await r.json();setStatus(d.note??d.error);if(r.ok){setMessage('');if(kind==='human_handoff')postHelpEvent(embed,{event:'handoff_requested',withinHours:typeof d.open==='boolean'?d.open:hours.open});else postHelpEvent(embed,{event:'message_sent',channel:'request'});if(email&&consent)postHelpEvent(embed,{event:'lead_submitted'});}}catch{setStatus('Could not send request.');}finally{setBusy(false);}
 }
 async function refundReview(a:Answer){if(!a.billing)return;setBusy(true);try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'billing_refund',token,lookupId:a.billing.lookupId,message:message.trim().length>=5?message:'Please review a refund for this payment.'})});const d=await r.json();setStatus(d.note??d.error);}catch{setStatus('Could not send the refund review request.');}finally{setBusy(false);}}
 async function talkToPerson(){setBusy(true);try{const r=await fetch('/api/support',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',token,kind:'human_handoff',message:message.trim().length>=5?message:'I would like to talk to a person, please.',...(email&&consent?{email}:{}),consent:!!(email&&consent)})});const d=await r.json();setStatus(d.note??d.error);if(r.ok&&typeof d.open==='boolean')setHours(h=>({...h,open:d.open}));if(r.ok){postHelpEvent(embed,{event:'handoff_requested',withinHours:typeof d.open==='boolean'?d.open:hours.open});if(email&&consent)postHelpEvent(embed,{event:'lead_submitted'});}}catch{setStatus('Could not ask for a person.');}finally{setBusy(false);}}
 /* Opens the request section with a kind chosen and a starting message, then moves to the email field. */
 function followUpByEmail(text:string){setKind('lead_callback');setMessage(m=>m.trim().length>=5?m:text);if(more)document.getElementById('help-email')?.focus();else{wantEmail.current=true;setMore(true);}}
 useEffect(()=>{if(more&&wantEmail.current){wantEmail.current=false;document.getElementById('help-email')?.focus();}},[more]);
 const last=turns[turns.length-1];
 const followUps=followUpsFor(item?.controls?.followUps,last?.q??'');
 const starters=startersFor(page,item?.controls?.pageStarters,item?.branding?.prompts??[]);
 const logo=item?.branding?.logoVersion&&token?'/api/widget/logo?token='+encodeURIComponent(token)+'&v='+item.branding.logoVersion:null;
 const verifiedProvider=item?.billingSupport?.verified?item.billingSupport.providers.find(p=>p.provider===item.billingSupport!.verified!.provider):undefined;
 const style={'--hp-accent':accent,'--hp-on-accent':foreground} as React.CSSProperties;
 return <DeskShell widget><main className="hp" style={style}>
  <header className="hp-head"><strong>{logo?<img src={logo} alt="" width={24} height={24} className="h-6 w-6 rounded object-contain"/>:item?.branding?.initials??'AP'} · {item?.branding?.label??'AutomatePal'}</strong><span>{modeText('Fictional demo',tx.tag)}</span></header>
  <div ref={threadRef} className="hp-thread" role="log" aria-label={(item?.branding?.label??'AutomatePal')+' chat'} tabIndex={0}>
   <div className="hp-intro"><h1>{tx.title}</h1><p className="hp-fine">{modeText('Demo fixture only. Questions are stored for the demo owner. Exact published owner responses are shown directly; other questions are sent to Gemini for source-based answers. Do not enter real customer or payment details. No refund is automatic.',tx.privacy)}</p></div>
   {item&&<>
    {!item.controls?.hideOrder&&item.billing&&<BillingCard item={item.billing}/>}
    {item.controls?.visitorChoice!==false&&!paused&&<div role="group" aria-label={tx.howHelp} className="hp-card"><p className="text-sm font-semibold">{tx.howHelp}</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={()=>document.getElementById('help-message')?.focus()} className="min-h-11 rounded-lg border p-3 text-sm">{tx.askAi}</button><button type="button" disabled={busy} onClick={talkToPerson} className="min-h-11 rounded-lg border p-3 text-sm">{tx.talkPerson}</button></div>{hours.open?<p className="hp-fine">{tx.personNow}</p>:<div className="mt-2 text-xs leading-5 text-gray-600"><p>{hours.away}</p>{!item.controls?.hideContact&&<button type="button" onClick={()=>followUpByEmail(modeText('Fictional demo: please follow up when the team is back.',tx.msgFollowBack))} className="mt-2 min-h-11 rounded-lg border px-3 py-2 text-xs">{tx.leaveEmail}</button>}</div>}</div>}
    {starters.length>0&&turns.length===0&&<div className="hp-chips">{starters.map(prompt=><button type="button" key={prompt} disabled={busy||paused} onClick={()=>ask(prompt)} className="hp-chip">{prompt}</button>)}</div>}
    {item.billingSupport&&<BillingVerify tx={tx} token={token} support={item.billingSupport} onVerified={v=>setItem(c=>c&&c.billingSupport?{...c,billingSupport:{...c.billingSupport,verified:v}}:c)}/>}
    {verifiedProvider&&<div className="hp-chips" role="group" aria-label={tx.billingQs}>{(Object.keys(INTENT_QUESTIONS) as (keyof typeof INTENT_QUESTIONS)[]).filter(i=>verifiedProvider.capabilities[i]).map(i=><button type="button" key={i} disabled={busy||paused} onClick={()=>ask(INTENT_QUESTIONS[i])} className="hp-chip">{INTENT_LABELS[i]}</button>)}</div>}
    {turns.map(turn=>{const a=turn.a,isLast=turn.id===last?.id;return <div key={turn.id} style={{display:'contents'}}>
     <p className="hp-q"><span className="hp-sr">{tx.yourQuestion}: </span>{turn.q}</p>
     {!a?<p className="hp-a"><span className="hp-typing"><i/><i/><i/>{tx.checking}</span></p>:<div className="hp-a">
      <p>{a.answer}</p>
      {!item.controls?.hideSources&&a.sources.map(s=><div key={s.id} className="mt-2 text-xs text-gray-500">{s.sourceKind==='owner_guidance'?tx.srcOwner:s.sourceKind==='billing_record'?tx.srcBilling:tx.srcSource}: {s.title} <details><summary>{tx.quote}</summary>{s.quotes?.map((q,i)=><q key={i}>{q}</q>)}</details></div>)}
      {a.billing?.cards.map(c=><BillingRecordCard key={c.kind+c.id} card={c}/>)}
      {a.billing&&a.billing.cards.length>0&&<button type="button" disabled={busy} onClick={()=>refundReview(a)} className="hp-btn mt-3">{tx.optRefund}</button>}
      <p className="mt-3 text-xs text-gray-500">{a.answerKind==='billing_record'?tx.noteBilling:a.answerKind==='billing_verification_required'?tx.noteVerify:a.answerKind==='owner_exact_response'?tx.noteExact:a.supported===false?tx.noteUnsupported:tx.noteAi} {tx.noGuarantee}</p>
      {isLast&&a.supported===false&&a.answerKind!=='billing_record'&&a.answerKind!=='billing_verification_required'&&<div className="mt-3 rounded-lg border border-blue-200 bg-white p-3">
       {!item.controls?.hideContact&&<p className="text-xs leading-5 text-gray-600">{modeText('This question could not be answered from published sources. Leave a fictional email and the demo owner can follow up on this case.',tx.unanswered)}</p>}
       <div className="mt-2 flex flex-wrap gap-2">
        {item.controls?.visitorChoice!==false&&!paused&&<button type="button" disabled={busy} onClick={talkToPerson} className="hp-btn">{tx.talkPerson}</button>}
        {!item.controls?.hideContact&&<button type="button" onClick={()=>followUpByEmail(modeText('Fictional demo: please follow up on my question.',tx.msgFollowUp))} className="hp-btn">{modeText('Request a demo follow-up',tx.optFollow)}</button>}
       </div></div>}
      {a.interactionId&&<div className="mt-3 flex gap-2"><button type="button" aria-pressed={turn.rated===1} onClick={()=>feedback(turn,1)} className="hp-btn">{tx.helpful}</button><button type="button" aria-pressed={turn.rated===-1} onClick={()=>feedback(turn,-1)} className="hp-btn">{tx.notHelpful}</button></div>}
      {isLast&&a.answerKind!=='billing_verification_required'&&followUps.length>0&&<div role="group" aria-label={tx.suggested} className="hp-chips mt-3">{followUps.map(f=><button type="button" key={f} disabled={busy||paused} onClick={()=>ask(f)} className="hp-chip">{f}</button>)}</div>}
     </div>}
    </div>;})}
    {inbox==='taken_over'&&<PersonChat tx={tx} token={token} messages={thread.messages} onSent={()=>{postHelpEvent(embed,{event:'message_sent',channel:'person'});void thread.refresh().catch(()=>{});}}/>}
    {!item.controls?.hideRating&&(turns.some(t=>t.a)||paused||rated>0)&&<div role="group" aria-label={tx.rateTitle} className="hp-card"><p className="text-sm font-semibold">{tx.rateTitle}</p><div className="mt-2 flex flex-wrap items-center gap-2"><span className="text-xs text-gray-500">{tx.rateLow}</span>{[1,2,3,4,5].map(n=><button type="button" key={n} aria-pressed={rated===n} aria-label={`${n} / 5`} onClick={()=>rate(n)} style={rated===n?{backgroundColor:accent,color:foreground,borderColor:accent}:undefined} className="h-11 w-11 rounded-lg border text-sm font-semibold">{n}</button>)}<span className="text-xs text-gray-500">{tx.rateHigh}</span></div></div>}
   </>}
   <p className="hp-fine">{modeText('This demo link is a temporary access key for a fictional case. It expires after one hour. Real merchant onboarding, customer authentication and refunds are not enabled.',item?.source==='widget'?tx.footer:'This chat link is a temporary access key for this conversation. It expires after one hour. Refunds are never automatic; a person reviews every refund request.')}</p>
  </div>
  <div className="hp-compose">
   <p aria-live="polite" role="status" className="hp-status">{status}</p>
   {item&&<>
    {paused&&<p className="hp-fine" style={{margin:'0 0 6px'}}>{inbox==='closed'?tx.closed:tx.paused}</p>}
    <form onSubmit={e=>{e.preventDefault();void ask();}}>
     <div className="hp-row">
      <label><span className="hp-sr">{tx.yourQuestion}</span><textarea id="help-message" rows={Math.min(4,Math.max(1,Math.ceil(message.length/30),message.split('\n').length))} maxLength={500} value={message} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void ask();}}} placeholder={modeText('Fictional details only',tx.yourQuestion)}/></label>
      <button type="submit" disabled={busy||message.trim().length<3||paused} className="hp-send">{busy?tx.checking:tx.ask}</button>
     </div>
     <div className="hp-under"><span aria-live="polite">{message.length}/500</span></div>
    </form>
    <details className="hp-more" open={more} onToggle={e=>setMore((e.currentTarget as HTMLDetailsElement).open)}>
     <summary>{tx.askReview}</summary>
     <div className="hp-more-body">
      <label>{tx.whatNeed}<select value={kind} onChange={e=>setKind(e.target.value)}><option value="billing_question">{tx.optBilling}</option><option value="refund_request">{tx.optRefund}</option><option value="receipt_request">{modeText('Request a demo receipt',tx.optReceipt)}</option><option value="human_handoff">{tx.askReview}</option><option value="lead_callback">{modeText('Request a demo follow-up',tx.optFollow)}</option></select></label>
      {!item.controls?.hideContact&&<label>{modeText('Demo contact email (optional)',tx.email)}<input id="help-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder={modeText('Use a fictional address',tx.emailPh)}/></label>}
      {email&&<label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>{modeText('Allow this demo owner to see the address for this request. The owner may reply to it by email; nothing is sent to it automatically.',tx.consent)}</label>}
      <button type="button" onClick={()=>void send()} disabled={busy} className="hp-send" style={{width:'100%'}}>{busy?tx.sending:tx.send}</button>
     </div>
    </details>
   </>}
  </div>
 </main></DeskShell>;
}
