'use client';
import {useEffect,useRef,useState} from 'react';
import {D,Dot,Glyph} from './draw';
import './pipeline.css';

/* Marketing explainer: shows the checks every answer passes before a customer sees it.
   Fictional example text only; not a live model call. Plays only while on screen,
   stops when the visitor picks a tab, and stays on the finished state for reduced
   motion or no-JS (initial step 4 = complete). Motion is CSS transitions on
   opacity/transform driven by data attributes, so state changes retarget smoothly.
   Each step's line icon draws itself on when that step lights up (pipeline.css). */

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
/* Lucide geometry (ISC), rebuilt as single paths so each stroke can draw on. */
const CIRCLE='M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0';
function stepIcon(i:number,review:boolean){
 switch(i){
  case 0:return <><D d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><Dot x={8} y={12} n={0}/><Dot x={12} y={12} n={1}/><Dot x={16} y={12} n={2}/></>;
  case 1:return <g className="a"><D d="M19 11a8 8 0 1 1-16 0a8 8 0 1 1 16 0"/><D d="m21 21-4.3-4.3" n={1}/></g>;
  case 2:return <><D d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><D d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" n={1}/></>;
  default:return review?<><D d={CIRCLE}/><D d="m15 9-6 6" n={1}/><D d="m9 9 6 6" n={2}/></>:<><D d={CIRCLE}/><D d="m9 12 2 2 4-4" n={1}/></>;
 }
}

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
 return <div ref={ref} className="hm-pipe" data-demo="answer-pipeline" data-scenario={sc.id} data-live={live&&auto}>
  <div className="hm-pipe-top">
   <span className="hm-pipe-live"><i aria-hidden="true"/>Every answer, checked</span>
   <div className="hm-tabs" role="group" aria-label="Example question">
    {SCENARIOS.map((x,i)=><button key={x.id} type="button" aria-pressed={i===s} onClick={()=>{setAuto(false);setS(i);setStep(4);}}>{x.tab}</button>)}
   </div>
  </div>
  <p className="hm-pipe-q" data-on={step>=0}><span>Visitor</span><b className="hm-pipe-qt" key={sc.id}>{sc.question}</b></p>
  <ol className="hm-steps">
   {STEP_NAMES.map((name,i)=><li key={name} className="hm-node" data-on={step>=i} data-warn={review&&i>=1} data-link={step>i}>
    <span className="hm-node-icon"><Glyph key={sc.id+i} name={'step-'+i} size={16} sw={2}>{stepIcon(i,review)}</Glyph></span>
    <span className="hm-node-name"><b>0{i+1}</b>{name}</span>
    <span className="hm-node-text">{sc.steps[i]}</span>
    {i<STEP_NAMES.length-1&&<span className="hm-link" aria-hidden="true"/>}
   </li>)}
  </ol>
  <div className="hm-outcomes">
   <div className="hm-out" data-cur={!review} data-on={done&&!review}>
    <span className="hm-out-tag"><Glyph name="sent" size={14} sw={2}><D d={CIRCLE}/><D d="m9 12 2 2 4-4" n={1}/></Glyph>Answer sent with its source</span>
    <p>The student plan includes 25 seats.</p>
    <span className="hm-out-meta">Source: student plan exception · fictional</span>
   </div>
   <div className="hm-out hm-out-review" data-cur={review} data-on={done&&review}>
    <span className="hm-out-tag"><Glyph name="queued" size={14} sw={2}><D d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><D d="M22 12h-6l-2 3h-4l-2-3H2" n={1}/></Glyph>Routed to your review queue</span>
    <p>Request · refund review · waiting for the owner</p>
    <span className="hm-out-meta">No guess reaches the customer</span>
   </div>
  </div>
 </div>;
}
