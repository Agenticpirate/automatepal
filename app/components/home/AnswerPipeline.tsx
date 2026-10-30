'use client';
import {useEffect,useRef,useState} from 'react';

/* Marketing explainer: shows the checks every answer passes before a customer sees it.
   Fictional example text only; not a live model call. Plays only while on screen,
   stops when the visitor picks a tab, and stays on the finished state for reduced
   motion or no-JS (initial step 4 = complete). Motion is CSS transitions on
   opacity/transform driven by data attributes, so state changes retarget smoothly. */

type Scenario={id:'answer'|'review';tab:string;question:string;steps:[string,string,string,string]};
const SCENARIOS:Scenario[]=[
 {id:'answer',tab:'Source found',question:'How many seats are in the student plan?',steps:[
  'Question received in the widget',
  'Matched a published passage in this workspace',
  '“The North Dock student plan includes 25 seats.”',
  'Answer agrees with the quote',
 ]},
 {id:'review',tab:'No source',question:'Can I get a refund for last month?',steps:[
  'Question received in the widget',
  'No published passage clears the match threshold',
  'Nothing to quote',
  'Cannot be verified, so no answer is sent',
 ]},
];
const STEP_NAMES=['Ask','Retrieve','Quote','Verify'];
const STEP_ICONS=[
 <path key="a" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
 <g key="r"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></g>,
 <g key="q"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></g>,
 <g key="v"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></g>,
];
const svg=(child:React.ReactNode,size=16)=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{child}</svg>;

export default function AnswerPipeline(){
 const[s,setS]=useState(0);
 const[step,setStep]=useState(4);
 const[auto,setAuto]=useState(true);
 const[live,setLive]=useState(false);
 const ref=useRef<HTMLDivElement>(null);

 useEffect(()=>{
  const el=ref.current;if(!el)return;
  const io=new IntersectionObserver(([e])=>setLive(e.isIntersecting&&!matchMedia('(prefers-reduced-motion: reduce)').matches),{threshold:.35});
  io.observe(el);return()=>io.disconnect();
 },[]);

 useEffect(()=>{
  if(!live||!auto)return;
  let n=-1,id=0;
  const run=()=>{
   n++;
   if(n<=4)setStep(n);
   else{n=-1;setS(x=>(x+1)%SCENARIOS.length);setStep(-1);}
   id=window.setTimeout(run,n===4?3600:n===-1?380:900);
  };
  id=window.setTimeout(run,250);
  return()=>clearTimeout(id);
 },[live,auto]);

 const sc=SCENARIOS[s],done=step>=4,review=sc.id==='review';
 return <div ref={ref} className="hm-pipe" data-scenario={sc.id}>
  <div className="hm-pipe-top">
   <span className="hm-pipe-live"><i aria-hidden="true"/>Every answer, checked</span>
   <div className="hm-tabs" role="group" aria-label="Example question">
    {SCENARIOS.map((x,i)=><button key={x.id} type="button" aria-pressed={i===s} onClick={()=>{setAuto(false);setS(i);setStep(4);}}>{x.tab}</button>)}
   </div>
  </div>
  <p className="hm-pipe-q" data-on={step>=0}><span>Visitor</span>{sc.question}</p>
  <ol className="hm-steps">
   {STEP_NAMES.map((name,i)=><li key={name} className="hm-node" data-on={step>=i} data-warn={review&&i>=1} data-link={step>i}>
    <span className="hm-node-icon">{svg(STEP_ICONS[i])}</span>
    <span className="hm-node-name"><b>0{i+1}</b>{name}</span>
    <span className="hm-node-text">{sc.steps[i]}</span>
    {i<STEP_NAMES.length-1&&<span className="hm-link" aria-hidden="true"/>}
   </li>)}
  </ol>
  <div className="hm-outcomes">
   <div className="hm-out" data-on={done&&!review}>
    <span className="hm-out-tag">{svg(<g><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></g>,14)}Answer sent with its source</span>
    <p>The student plan includes 25 seats.</p>
    <span className="hm-out-meta">Source: student plan exception · fictional</span>
   </div>
   <div className="hm-out hm-out-review" data-on={done&&review}>
    <span className="hm-out-tag">{svg(<g><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></g>,14)}Routed to your review queue</span>
    <p>Request · refund review · waiting for the owner</p>
    <span className="hm-out-meta">No guess reaches the customer</span>
   </div>
  </div>
 </div>;
}
