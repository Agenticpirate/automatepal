'use client';
import {useEffect,useRef,useState} from 'react';
import {AddOnGlyph,type AddOnIcon} from './AddOnIcons';
import {SITE_BILLING_PROVIDERS,capabilityExceptions} from './billing-providers';
import './addons.css';

/* Add-ons and integrations. Statuses mirror app/integrations/Addons.tsx and FEATURES.md:
   "Available" is built and testable, "Preview" is partly built or off by default,
   "Coming soon" is planned and not connected. No third-party logos are used. */
type Status='Available'|'Preview'|'Coming soon';
type AddOn={name:string;body:string;status:Status;icon:AddOnIcon;tone:string};
const ADDONS:AddOn[]=[
 {name:'Team roles',body:'Owner, admin, manager and agent seats with private invite links and an audit trail.',status:'Available',icon:'team',tone:'#041A52'},
 {name:'Read-only API',body:'Scoped tokens that expire in 1 to 168 hours, for support, analytics and health metadata.',status:'Available',icon:'api',tone:'#09318D'},
 {name:'Signed webhooks',body:'Event metadata signed with HMAC-SHA256 and delivered to a URL you own, with retries.',status:'Available',icon:'webhook',tone:'#0B3CA8'},
 {name:'CSV exports',body:'Unanswered questions, sources and tickets as formula-safe spreadsheets.',status:'Available',icon:'csv',tone:'#1F4FBF'},
 {name:'Lead capture',body:'An optional contact step in the widget that asks for consent before saving an email.',status:'Available',icon:'lead',tone:'#E25FAE'},
 {name:'Billing lookups',body:`Read-only order, payment, invoice, renewal and refund-status answers from ${SITE_BILLING_PROVIDERS.length} payment providers, where the provider supports the lookup, after the customer verifies. ${capabilityExceptions()} Test or live mode; refunds stay review-only.`,status:'Preview',icon:'billing',tone:'#A3226F'},
 {name:'MCP server',body:'Connect an MCP client with a scoped, expiring token: read tickets, sources and counts, or propose a source that stays unpublished.',status:'Preview',icon:'plug',tone:'#09318D'},
 {name:'Email alerts',body:'Refund, handoff and unanswered-question alerts. Rules save today; delivery starts after sender verification.',status:'Preview',icon:'email',tone:'#B4237A'},
 {name:'Weekly digest',body:'Unanswered questions grouped by theme, ready to turn into answers.',status:'Preview',icon:'digest',tone:'#0E2E74'},
 {name:'Zapier and Make',body:'Send events to thousands of apps through the signed webhooks.',status:'Coming soon',icon:'automation',tone:'#5B6B8C'},
 {name:'Slack',body:'Alerts and handoff notices in the channel your team already watches.',status:'Coming soon',icon:'channel',tone:'#5B6B8C'},
 {name:'Google Chat',body:'Owner alerts in a Google Chat space.',status:'Coming soon',icon:'chat',tone:'#5B6B8C'},
 {name:'Zendesk',body:'Turn review items into Zendesk tickets and keep their status in sync.',status:'Coming soon',icon:'helpdesk',tone:'#5B6B8C'},
 {name:'Freshdesk',body:'Create Freshdesk tickets from the review queue.',status:'Coming soon',icon:'ticket',tone:'#5B6B8C'},
 {name:'Crisp',body:'Answer visitors inside your Crisp inbox.',status:'Coming soon',icon:'inbox',tone:'#5B6B8C'},
 {name:'Messenger',body:'Answer Facebook Page messages from the same knowledge.',status:'Coming soon',icon:'messenger',tone:'#5B6B8C'},
 {name:'WhatsApp Business',body:'Answer WhatsApp messages from the same knowledge.',status:'Coming soon',icon:'whatsapp',tone:'#5B6B8C'},
];
const FILTERS:('All'|Status)[]=['All','Available','Preview','Coming soon'];

export default function AddOns(){
 const[f,setF]=useState<'All'|Status>('All');
 const wrap=useRef<HTMLDivElement>(null);
 /* Icons draw on once, the first time the grid scrolls into view. The wrapper (not the re-keyed list)
    carries the state, so switching tabs never strands icons in the hidden state. Without JS, or with
    reduced motion, the icons simply render drawn. */
 useEffect(()=>{
  const el=wrap.current;
  if(!el||matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window))return;
  el.dataset.icons='armed';
  const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){el.dataset.icons='drawn';io.disconnect();}},{threshold:.15});
  io.observe(el);
  return()=>{io.disconnect();el.dataset.icons='drawn';};
 },[]);
 const shown=ADDONS.filter(a=>f==='All'||a.status===f);
 return <div ref={wrap} className="hm-addons-wrap">
  <div className="hm-addon-tabs" role="tablist" aria-label="Filter add-ons">
   {FILTERS.map(x=><button key={x} type="button" role="tab" aria-selected={f===x} onClick={()=>setF(x)}>{x}<span>{x==='All'?ADDONS.length:ADDONS.filter(a=>a.status===x).length}</span></button>)}
  </div>
  <ul className="hm-addons" key={f}>
   {shown.map((a,i)=><li key={a.name} className="hm-addon" style={{'--i':i} as React.CSSProperties} data-status={a.status}>
    <span className="hm-addon-ico" style={{'--tone':a.tone} as React.CSSProperties} aria-hidden="true"><AddOnGlyph name={a.icon}/></span>
    <div><h3>{a.name}</h3><p>{a.body}</p></div>
    <em className="hm-addon-status">{a.status}</em>
   </li>)}
  </ul>
 </div>;
}
