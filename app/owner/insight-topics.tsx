'use client';
/* Owner-editable topic list for AI conversation insights (db/051). "Other" is always available. */
import {useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
const DEFAULTS=['Billing','Shipping','Refunds','Account','Product','Technical issue'];
export default function InsightTopics({topics,enabled,available}:{topics:string[]|null;enabled:boolean;available:boolean}){
 const[text,setText]=useState((topics??DEFAULTS).join('\n')),[on,setOn]=useState(enabled),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 if(!available)return null;
 async function save(){setBusy(true);try{const list=text.split('\n').map(t=>t.trim()).filter(Boolean);const r=await fetch('/api/insights',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({topics:list,enabled:on})});const d=await r.json().catch(()=>({}));setNotice(d.note??d.error??'Not saved.');}catch{setNotice('Not saved. Try again.');}finally{setBusy(false);}}
 return <section className="ap-dash-card" aria-labelledby="ap-topics-h" style={{marginTop:16}}>
  <h2 id="ap-topics-h" className="ap-dash-h2">AI conversation topics</h2>
  <p className="ap-dash-muted ap-od-desc">Finished conversations are labelled in small batches by a low-cost model with one of these topics (or Other), a sentiment and an outcome. It runs with the hourly scheduled job, inside the daily model spend cap, and never slows down chat.</p>
  <label className="ap-dash-field" style={{display:'block',marginTop:8}}>Topics, one per line (1 to 12)<textarea className="ap-dash-select" rows={6} maxLength={600} value={text} onChange={e=>setText(e.target.value)} style={{width:'100%',fontFamily:'inherit'}}/></label>
  <label style={{display:'flex',gap:8,alignItems:'center',minHeight:44}}><input type="checkbox" checked={on} onChange={e=>setOn(e.target.checked)}/>Label conversations with AI</label>
  <button type="button" className="ap-dash-btn" disabled={busy} onClick={()=>void save()} style={{minHeight:44}}>Save topics</button>
  <p role="status" className="ap-dash-muted" style={{marginTop:6}}>{notice}</p>
 </section>;
}
