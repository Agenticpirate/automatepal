'use client';
import {useState} from 'react';

/* Add-ons and integrations. Statuses mirror app/integrations/Addons.tsx and FEATURES.md:
   "Available" is built and testable, "Preview" is partly built or off by default,
   "Coming soon" is planned and not connected. No third-party logos are used. */
type Status='Available'|'Preview'|'Coming soon';
type AddOn={name:string;body:string;status:Status;mono:string;tone:string};
const ADDONS:AddOn[]=[
 {name:'Team roles',body:'Owner, admin, manager and agent seats with private invite links and an audit trail.',status:'Available',mono:'TR',tone:'#041A52'},
 {name:'Read-only API',body:'Scoped tokens that expire in 1 to 168 hours, for support, analytics and health metadata.',status:'Available',mono:'API',tone:'#09318D'},
 {name:'Signed webhooks',body:'Event metadata signed with HMAC-SHA256 and delivered to a URL you own, with retries.',status:'Available',mono:'WH',tone:'#0B3CA8'},
 {name:'CSV exports',body:'Unanswered questions, sources and tickets as formula-safe spreadsheets.',status:'Available',mono:'CSV',tone:'#1F4FBF'},
 {name:'Lead capture',body:'An optional contact step in the widget that asks for consent before saving an email.',status:'Available',mono:'LC',tone:'#E25FAE'},
 {name:'Billing lookups',body:'Order, invoice and payment answers from your billing records, read-only.',status:'Preview',mono:'BL',tone:'#A3226F'},
 {name:'Email alerts',body:'Refund, handoff and unanswered-question alerts. Rules save today; delivery starts after sender verification.',status:'Preview',mono:'EM',tone:'#C2185B'},
 {name:'Weekly digest',body:'Unanswered questions grouped by theme, ready to turn into answers.',status:'Preview',mono:'WD',tone:'#7B2FBF'},
 {name:'Zapier and Make',body:'Send events to thousands of apps through the signed webhooks.',status:'Coming soon',mono:'Z',tone:'#5B6B8C'},
 {name:'Slack',body:'Alerts and handoff notices in the channel your team already watches.',status:'Coming soon',mono:'S',tone:'#5B6B8C'},
 {name:'Google Chat',body:'Owner alerts in a Google Chat space.',status:'Coming soon',mono:'GC',tone:'#5B6B8C'},
 {name:'Zendesk',body:'Turn review items into Zendesk tickets and keep their status in sync.',status:'Coming soon',mono:'ZD',tone:'#5B6B8C'},
 {name:'Freshdesk',body:'Create Freshdesk tickets from the review queue.',status:'Coming soon',mono:'FD',tone:'#5B6B8C'},
 {name:'Crisp',body:'Answer visitors inside your Crisp inbox.',status:'Coming soon',mono:'CR',tone:'#5B6B8C'},
 {name:'Messenger',body:'Answer Facebook Page messages from the same knowledge.',status:'Coming soon',mono:'FB',tone:'#5B6B8C'},
 {name:'WhatsApp Business',body:'Answer WhatsApp messages from the same knowledge.',status:'Coming soon',mono:'WA',tone:'#5B6B8C'},
];
const FILTERS:('All'|Status)[]=['All','Available','Preview','Coming soon'];

export default function AddOns(){
 const[f,setF]=useState<'All'|Status>('All');
 const shown=ADDONS.filter(a=>f==='All'||a.status===f);
 return <>
  <div className="hm-addon-tabs" role="tablist" aria-label="Filter add-ons">
   {FILTERS.map(x=><button key={x} type="button" role="tab" aria-selected={f===x} onClick={()=>setF(x)}>{x}<span>{x==='All'?ADDONS.length:ADDONS.filter(a=>a.status===x).length}</span></button>)}
  </div>
  <ul className="hm-addons" key={f}>
   {shown.map((a,i)=><li key={a.name} className="hm-addon" style={{'--i':i} as React.CSSProperties} data-status={a.status}>
    <span className="hm-addon-mono" style={{background:a.tone}} aria-hidden="true">{a.mono}</span>
    <div><h3>{a.name}</h3><p>{a.body}</p></div>
    <em className="hm-addon-status">{a.status}</em>
   </li>)}
  </ul>
 </>;
}
