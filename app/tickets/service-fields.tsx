'use client';
import {useRouter} from 'next/navigation';
import {useState} from 'react';
import Link from 'next/link';
import {type Ticket,matrixPriority,ticketLabel} from '../../lib/tickets';

/* Impact/urgency are 1-3. Older rows can hold other values; fall back to the defaults instead of NaN priorities. */
const level=(v:unknown,d:number)=>typeof v==='number'&&v>=1&&v<=3?v:d;

export default function ServiceFields({ticket:t,rows,busy,act}:{ticket:Ticket;rows:Ticket[];busy:boolean;act:(b:unknown)=>Promise<unknown>}){
 const[type,setType]=useState(t.ticket_type??'question'),[impact,setImpact]=useState(level(t.impact,3)),[urgency,setUrgency]=useState(level(t.urgency,2)),[queue,setQueue]=useState(t.assignment_queue??'general'),[related,setRelated]=useState(t.related_ticket??'');
 return <div className="ap-ib-svc">
  <p className="ap-ib-note">Queues are labels for one owner, not separate teams. Impact and urgency: 1 highest, 3 lowest. Saving recalculates priority; manual priority overrides remain possible.</p>
  <div className="ap-ib-svc-grid">
   <label className="ap-ib-field">Ticket type<select value={type} onChange={e=>setType(e.target.value)}>{['incident','service_request','question'].map(x=><option key={x} value={x}>{x.replace('_',' ')}</option>)}</select></label>
   <label className="ap-ib-field">Assignment queue<select value={queue} onChange={e=>setQueue(e.target.value)}>{['general','technical','billing','knowledge'].map(x=><option key={x}>{x}</option>)}</select></label>
   {([['Impact',impact,setImpact],['Urgency',urgency,setUrgency]] as const).map(([label,value,set])=><label key={label} className="ap-ib-field">{label}<select value={value} onChange={e=>set(Number(e.target.value))}>{[1,2,3].map(x=><option key={x} value={x}>{x} - {x===1?'high':x===2?'medium':'low'}</option>)}</select></label>)}
  </div>
  <p className="ap-ib-note">Computed priority: <b>{matrixPriority(impact,urgency)}</b></p>
  <details className="ap-ib-matrix"><summary>View priority matrix</summary><table><caption>Rows: impact. Columns: urgency.</caption><thead><tr><th>Impact / urgency</th><th>1</th><th>2</th><th>3</th></tr></thead><tbody>{[1,2,3].map(i=><tr key={i}><th>{i}</th>{[1,2,3].map(u=><td key={u}>{matrixPriority(i,u)}</td>)}</tr>)}</tbody></table></details>
  <label className="ap-ib-field">Related / potential duplicate (loaded tickets only)<select value={related} onChange={e=>setRelated(e.target.value)}><option value="">None</option>{rows.filter(x=>x.id!==t.id).map(x=><option key={x.id} value={x.id}>{ticketLabel(x.id)} · {x.order_label}</option>)}</select></label>
  <p className="ap-ib-note">One related record. No merge, automatic deduplication, status propagation or copied customer text.</p>
  <div><button type="button" disabled={busy} onClick={()=>act({action:'service',id:t.id,type,impact,urgency,queue,related:related||null})} className="ap-ib-btn primary">Save service fields</button></div>
 </div>;
}

/* Resolved/closed tickets: hand a reviewed Q&A draft to the Knowledge page through this tab's sessionStorage. */
export function QaDraft(){
 const router=useRouter();
 const[question,setQuestion]=useState(''),[answer,setAnswer]=useState('');
 return <section className="ap-ib-qa" aria-label="Prepare resolved ticket as Q&A">
  <h3>Prepare resolved ticket as Q&amp;A</h3>
  <p className="ap-ib-note">Write a reusable fictional question and verified answer. Internal notes are never copied automatically. This transfers an unsaved draft in this tab; nothing is published or sent to a model.</p>
  <label className="ap-ib-field">Reusable question<input id="ap-ib-qa-q" value={question} maxLength={300} onChange={e=>setQuestion(e.target.value)}/></label>
  <label className="ap-ib-field">Reviewed answer<textarea value={answer} maxLength={5000} rows={4} onChange={e=>setAnswer(e.target.value)}/></label>
  <div className="ap-ib-qa-row">
   <button type="button" disabled={question.trim().length<3||answer.trim().length<10} onClick={()=>{sessionStorage.setItem('automatepal-ticket-qa',JSON.stringify({question,answer}));router.push('/knowledge');}} className="ap-ib-btn primary">Prepare private Q&amp;A draft</button>
   <Link href="/knowledge" className="ap-ib-link">Review existing knowledge sources</Link>
  </div>
 </section>;
}
