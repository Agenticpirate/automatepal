'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {BotMark,ProfileMark} from './BotMark';

/* Interactive chat demo for the home page (SiteGPT-style "see it for yourself" section).
   Scripted, fictional North Dock store with PayPal sandbox-style records. Nothing leaves the
   page: no AI call, no payment, no message. The select + "Try this question" button are the
   accessible composer and the contract scripts/verify-landing.mjs relies on. */

type CardKind='order'|'payments'|'invoice'|'review';
type Source={label:string;quote:string};
type Step={from:'user'|'bot';text:string;source?:Source;card?:CardKind};
type QueueItem={kind:'Request'|'Question';title:string;state:string};
type Scenario={label:string;group:'Support'|'Billing';steps:Step[];queue?:QueueItem;outcome:'answered'|'review'};
type Msg=Step&{id:number};

const ORDER_ID='8XK41672LP0193344';
const SCENARIOS:Scenario[]=[
 {label:'How many seats are in the student plan?',group:'Support',outcome:'answered',steps:[
  {from:'user',text:'How many seats are in the student plan?'},
  {from:'bot',text:'The fictional North Dock student plan includes 25 seats.',source:{label:'Student plan exception · fictional source',quote:'“The North Dock student plan includes 25 seats.”'}},
 ]},
 {label:'Can someone review my refund request?',group:'Billing',outcome:'review',queue:{kind:'Request',title:'Refund review · Launch Kit order',state:'Waiting for owner'},steps:[
  {from:'user',text:'Can someone review my refund request?'},
  {from:'bot',text:'This needs an owner review. No refund has been issued.',card:'review'},
 ]},
 {label:'Where is my order, and was I charged?',group:'Billing',outcome:'answered',steps:[
  {from:'user',text:'Where is my order, and was I charged?'},
  {from:'bot',text:'I can check that in PayPal. What’s your order ID and the email you paid with?'},
  {from:'user',text:`${ORDER_ID} · buyer@example.com`},
  {from:'bot',text:'Found it. Your Launch Kit payment went through 12 days ago and there are no refunds on it.',card:'order',source:{label:'PayPal sandbox order · read-only lookup',quote:`Order ${ORDER_ID} · capture COMPLETED · USD 49.00`}},
 ]},
 {label:'Why did my last payment fail?',group:'Billing',outcome:'answered',steps:[
  {from:'user',text:'Why did my last payment fail?'},
  {from:'bot',text:'Your USD 12.00 renewal 3 days ago was declined for insufficient funds. PayPal retried yesterday and it went through, so your plan is active.',card:'payments'},
 ]},
 {label:'Can I get the invoice for my order?',group:'Billing',outcome:'answered',steps:[
  {from:'user',text:'Can I get the invoice for my order?'},
  {from:'bot',text:'Here’s the invoice for the Launch Kit order on this chat. It’s paid in full.',card:'invoice'},
 ]},
 {label:'Do you ship to Pune?',group:'Support',outcome:'review',queue:{kind:'Question',title:'Delivery to Pune',state:'Unanswered'},steps:[
  {from:'user',text:'Do you ship to Pune?'},
  {from:'bot',text:'North Dock’s sources don’t cover delivery to Pune, so I won’t guess. I’ve passed your question to the team.'},
 ]},
];
const WELCOME:Msg={id:0,from:'bot',text:'Hi! I answer from North Dock’s published sources and can look up orders, invoices and payments in PayPal. Pick a question below.'};

const I={
 send:<path d="m5 12 14 0M13 6l6 6-6 6"/>,
 quote:<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1zM15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>,
 inbox:<g><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></g>,
 card:<g><rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/></g>,
 restart:<g><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></g>,
 check:<path d="M20 6 9 17l-5-5"/>,
 x:<g><path d="M18 6 6 18"/><path d="m6 6 12 12"/></g>,
};
const Ico=({d,s=14}:{d:React.ReactNode;s?:number})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

function Row({k,v,tone}:{k:string;v:string;tone?:'ok'|'warn'}){return <div className="hm-bill-row"><span>{k}</span><b data-tone={tone}>{v}</b></div>;}
function BillCard({kind}:{kind:CardKind}){
 if(kind==='order')return <div className="hm-bill"><div className="hm-bill-head"><span>PayPal sandbox order</span><em>Read-only</em></div>
  <Row k="Order ID" v={ORDER_ID}/><Row k="Item" v="Fictional Launch Kit"/><Row k="Amount" v="USD 49.00"/><Row k="Payment" v="Captured · COMPLETED" tone="ok"/><Row k="Refunds" v="None"/></div>;
 if(kind==='invoice')return <div className="hm-bill"><div className="hm-bill-head"><span>PayPal sandbox invoice</span><em>Paid</em></div>
  <Row k="Invoice" v="INV2-NDK7-4Q2M-8RTA"/><Row k="Amount" v="USD 49.00"/><Row k="Status" v="PAID" tone="ok"/><Row k="Issued" v="12 days ago"/></div>;
 if(kind==='payments')return <div className="hm-bill"><div className="hm-bill-head"><span>Monthly plan · USD 12.00</span><em>Active</em></div>
  <ol className="hm-bill-tl"><li data-tone="warn"><b>Renewal declined</b><span>Insufficient funds · 3 days ago</span></li><li data-tone="ok"><b>Automatic retry paid</b><span>USD 12.00 · yesterday</span></li><li><b>Next renewal</b><span>In 29 days</span></li></ol></div>;
 return <div className="hm-bill hm-bill-review"><div className="hm-bill-head"><span>Service request · AP-1043</span><em>Pending</em></div>
  <Row k="Type" v="Refund review"/><Row k="Next step" v="Owner approves or declines"/><p className="hm-bill-note">No money moves until the owner decides.</p></div>;
}

export default function BotDemo(){
 const[msgs,setMsgs]=useState<Msg[]>([WELCOME]);
 const[pick,setPick]=useState(0);
 const[typing,setTyping]=useState(false);
 const[busy,setBusy]=useState(false);
 const[queue,setQueue]=useState<(QueueItem&{id:number})[]>([]);
 const[tally,setTally]=useState({answered:0,review:0});
 const[open,setOpen]=useState(true);
 const logRef=useRef<HTMLDivElement>(null);
 const timers=useRef<number[]>([]);
 const nextId=useRef(1);
 useEffect(()=>()=>timers.current.forEach(clearTimeout),[]);
 // Scroll the chat log itself, never the page.
 useEffect(()=>{const el=logRef.current;if(!el)return;const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;el.scrollTo({top:el.scrollHeight,behavior:reduce?'auto':'smooth'});},[msgs,typing]);

 function run(i:number){
  if(busy)return;
  const sc=SCENARIOS[i];setPick(i);setBusy(true);
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t=0;
  const later=(ms:number,fn:()=>void)=>{t+=reduce?0:ms;timers.current.push(window.setTimeout(fn,t));};
  sc.steps.forEach((st,k)=>{
   if(st.from==='user')later(k===0?0:420,()=>setMsgs(m=>[...m,{...st,id:nextId.current++}]));
   else{later(260,()=>setTyping(true));later(st.card?950:760,()=>{setTyping(false);setMsgs(m=>[...m,{...st,id:nextId.current++}]);});}
  });
  later(160,()=>{
   if(sc.queue){const q=sc.queue;setQueue(x=>[{...q,id:nextId.current++},...x].slice(0,4));}
   setTally(x=>({...x,[sc.outcome]:x[sc.outcome]+1}));
   setBusy(false);
  });
 }
 function reset(){timers.current.forEach(clearTimeout);timers.current=[];setMsgs([WELCOME]);setTyping(false);setBusy(false);setQueue([]);setTally({answered:0,review:0});}

 return <div className="hm-demo-grid">
  <div className="hm-demo-head">
   <p className="hm-kicker">01 / Interactive demo</p>
   <h2 id="demo-title" className="hm-h2">Support and billing, <span className="ap-hl">in one chat</span>.</h2>
   <p className="hm-lede">Ask North Dock, a fictional store. Product questions are answered from its published sources with the quote attached. Billing questions are checked against PayPal sandbox records, and anything risky waits for the owner.</p>
  </div>
  <div className="hm-demo-side">
   <ul className="hm-demo-points">
    <li><span><Ico d={I.quote} s={15}/></span><div><b>Answers cite the exact passage</b><small>A separate check must agree before the reply is sent.</small></div></li>
    <li><span><Ico d={I.card} s={15}/></span><div><b>Orders, invoices and payments from PayPal <em className="hm-tag">Preview</em></b><small>Read-only sandbox lookups after the customer confirms their order.</small></div></li>
    <li><span><Ico d={I.inbox} s={15}/></span><div><b>Refunds and unknowns go to you</b><small>The bot opens a review item instead of guessing or moving money.</small></div></li>
   </ul>
   <section className="hm-queue" aria-label="Owner review queue">
    <div className="hm-queue-head"><b>Owner review queue</b><span>{tally.answered} answered · {tally.review} sent to review</span></div>
    {queue.length?<ul>{queue.map(q=><li key={q.id}><em data-kind={q.kind}>{q.kind}</em><span>{q.title}</span><small>{q.state}</small></li>)}</ul>
     :<p className="hm-queue-empty">Nothing needs you yet. Try the refund or Pune question.</p>}
   </section>
  </div>

  <div className="hm-chat-wrap">
   <div className="hm-chat-stage">
   <div className="hm-chat" data-open={open} aria-hidden={!open} inert={!open}>
    <header className="hm-chat-head">
     <span className="hm-chat-avatar"><BotMark size={34} typing={typing}/></span>
     <div><strong>North Dock Assistant</strong><p><i aria-hidden="true"/>{typing?'Typing…':'Answers from sources · PayPal sandbox'}</p></div>
     <button type="button" className="hm-chat-reset" onClick={reset} aria-label="Restart demo" title="Restart demo"><Ico d={I.restart}/></button>
    </header>
    <div className="hm-chat-log" ref={logRef} role="log" aria-live="polite" aria-label="Demo conversation">
     {msgs.map((m,i)=>{const last=i===msgs.length-1?!(typing&&m.from==='bot'):msgs[i+1].from!==m.from;return <div key={m.id} className={'hm-row hm-row-'+m.from}>
      <span className="hm-av">{last&&(m.from==='bot'?<BotMark size={28}/>:<ProfileMark size={28}/>)}</span>
      <div className={'hm-msg hm-msg-'+m.from}>
       <div className="hm-bubble"><p>{m.text}</p></div>
       {m.card&&<BillCard kind={m.card}/>}
       {m.source&&<details className="hm-src"><summary><Ico d={I.check} s={12}/>{m.source.label}</summary><p>{m.source.quote}</p></details>}
      </div>
     </div>;})}
     {typing&&<div className="hm-row hm-row-bot"><span className="hm-av"><BotMark size={28} typing/></span><div className="hm-msg hm-msg-bot"><div className="hm-bubble hm-typing" aria-label="North Dock is typing"><i/><i/><i/></div></div></div>}
    </div>
    <div className="hm-chat-quick" role="group" aria-label="Suggested questions">
     {SCENARIOS.map((s,i)=><button type="button" key={s.label} data-group={s.group} disabled={busy} onClick={()=>run(i)}>{s.label}</button>)}
    </div>
    <form className="hm-chat-composer" onSubmit={e=>{e.preventDefault();run(pick);}}>
     <label htmlFor="demo-scenario" className="hm-sr">Choose a fictional question</label>
     <select id="demo-scenario" value={pick} onChange={e=>setPick(Number(e.target.value))}>
      <optgroup label="Support">{SCENARIOS.map((s,i)=>s.group==='Support'?<option key={i} value={i}>{s.label}</option>:null)}</optgroup>
      <optgroup label="Billing · PayPal sandbox">{SCENARIOS.map((s,i)=>s.group==='Billing'?<option key={i} value={i}>{s.label}</option>:null)}</optgroup>
     </select>
     <button type="submit" disabled={busy} aria-label="Ask: try this question"><span>Ask</span><Ico d={I.send}/></button>
    </form>
   </div>
   <p className="hm-chat-teaser" data-show={!open} aria-hidden={open}>Questions about an order or a bill? Ask me.</p>
   <button type="button" className="hm-launcher" aria-expanded={open} aria-label={open?'Close chat':'Open chat'} onClick={()=>setOpen(o=>!o)}>
    <span className="hm-launcher-face" data-face="bot"><BotMark size={40}/></span>
    <span className="hm-launcher-face" data-face="x"><Ico d={I.x} s={20}/></span>
   </button>
   </div>
   <p className="hm-chat-note">Scripted walkthrough on fictional data. No AI call, payment or message leaves this page. <Link href="/support">Create your one-hour live widget demo ↗</Link></p>
  </div>
 </div>;
}
