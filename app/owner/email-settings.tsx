'use client';
/* Owner email notifications: turn each automatic email off (the "unsubscribe" every email links to) and see
   the latest sends. Metadata only. */
import {useEffect,useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
type Settings={owner_alerts:boolean;weekly_digest:boolean;new_leads:boolean};
type Log={id:string;created_at:string;email_type:string;status:string};
const LABELS:[keyof Settings,string,string][]=[
 ['owner_alerts','Owner alerts','When a visitor asks for a person or a refund review opens. No visitor text is included.'],
 ['new_leads','New leads','When a visitor leaves contact details with consent. The address stays in your dashboard.'],
 ['weekly_digest','Weekly digest','Last week\u2019s counts with the change from the week before, and the top unanswered questions.'],
];
const STATUS:Record<string,string>={sent:'sent',dry_run:'dry run (not sent)',failed:'failed',suppressed_cap:'skipped: daily limit',suppressed_off:'skipped: turned off',reserved:'sending'};
export default function EmailSettings(){
 const[s,setS]=useState<Settings|null>(null),[log,setLog]=useState<Log[]>([]),[transport,setTransport]=useState(''),[canEdit,setCanEdit]=useState(false),[caps,setCaps]=useState(''),[notice,setNotice]=useState('Loading email settings...'),[busy,setBusy]=useState(false);
 async function read(keep=false){const r=await fetch('/api/email-settings',{headers:await authHeaders()});const x=await r.json().catch(()=>({}));if(!r.ok||!x.settings){setNotice(x.error??'Email settings unavailable.');return;}setS(x.settings);setLog(x.log??[]);setTransport(x.transport);setCanEdit(!!x.canEdit);setCaps(x.caps??'');if(!keep)setNotice(x.transport==='resend'?'Email delivery is on.':'Email delivery is off on this server (no RESEND_API_KEY), so every email is recorded as a dry run and not sent.');}
 useEffect(()=>{Promise.resolve().then(()=>read()).catch(()=>setNotice('Email settings unavailable.'));},[]);
 async function save(next:Settings){setBusy(true);setS(next);try{const r=await fetch('/api/email-settings',{method:'POST',headers:{...await authHeaders(),'Content-Type':'application/json'},body:JSON.stringify(next)});const x=await r.json().catch(()=>({}));setNotice(x.note??x.error??'Not saved.');if(r.ok)await read(true);}catch{setNotice('Outcome unconfirmed. Reload before trying again.');}finally{setBusy(false);}}
 return <section id="email-settings" className="ap-dash-card" aria-labelledby="ap-email-h" style={{marginTop:16}}>
  <div className="ap-od-cardhead"><h2 id="ap-email-h" className="ap-dash-h2">Email notifications</h2>{transport&&<span className={'ap-dash-badge '+(transport==='resend'?'ap-dash-b-ok':'ap-dash-b-mut')}>{transport==='resend'?'Delivery on':'Dry run only'}</span>}</div>
  <p role="status" className="ap-dash-muted ap-od-desc">{notice}</p>
  {s&&<><ul className="ap-od-queue" aria-label="Automatic emails">{LABELS.map(([k,label,hint])=><li key={k}><label style={{display:'flex',gap:10,alignItems:'flex-start',minHeight:44}}><input type="checkbox" checked={s[k]} disabled={busy||!canEdit} onChange={e=>void save({...s,[k]:e.target.checked})}/><span><strong>{label}</strong><br/><small className="ap-dash-muted">{hint}</small></span></label></li>)}</ul>
   {!canEdit&&<p className="ap-dash-muted">Only admins and the owner can change these.</p>}
   <p className="ap-dash-muted" style={{marginTop:8}}>{caps} Team invites and replies you choose to email a visitor are sent only when you ask. Visitor messages are never emailed to anyone outside your team.</p>
   <h3 className="ap-dash-h2" style={{fontSize:14,marginTop:12}}>Latest emails</h3>
   {!log.length?<p className="ap-dash-muted">No emails yet.</p>:<ol className="ap-od-queue">{log.map(l=><li key={l.id}><span>{l.email_type.replace(/_/g,' ')} · {new Date(l.created_at).toISOString().slice(0,16).replace('T',' ')} UTC</span><strong>{STATUS[l.status]??l.status}</strong></li>)}</ol>}
  </>}
 </section>;
}
