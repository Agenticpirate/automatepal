'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {usePathname} from 'next/navigation';
import './dash.css';

/* Lucide (ISC) inline icons */
export const DP: Record<string, React.ReactNode> = {
  overview:(<><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></>),
  tickets:(<><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></>),
  widget:(<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>),
  knowledge:(<><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></>),
  setup:(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>),
  status:(<><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></>),
  bell:(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>),
  search:(<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>),
  sparkles:(<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>),
  x:(<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>),
  alert:(<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>),
  checkcircle:(<><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></>),
  info:(<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>),
  refresh:(<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></>),
  audit:(<><path d="M14 2v6h6"/><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M9 15h6"/><path d="M9 11h2"/></>),
  catalog:(<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>),
};
export const DIcon=({name,size=16,sw=2}:{name:keyof typeof DP;size?:number;sw?:number})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{DP[name]}</svg>
);

export type DashNotif={id:string;kind:'error'|'success'|'info';title:string;body:string;ts:string};
const NAV:[string,string,keyof typeof DP][]=[['/owner','Overview','overview'],['/tickets','Tickets','tickets'],['/support','Widget studio','widget'],['/knowledge','Knowledge','knowledge'],['/setup','Setup','setup'],['/status','Status','status']];

function rel(ts:string){const s=Math.max(0,Date.now()-Date.parse(ts))/1000;if(s<60)return 'just now';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

export default function DashShell({crumb,notifications=[],search,onSearch,children}:{crumb:string;notifications?:DashNotif[];search?:string;onSearch?:(v:string)=>void;children:React.ReactNode}){
  const path=usePathname();
  const[open,setOpen]=useState(false);
  const[tab,setTab]=useState<'all'|'error'|'success'|'info'>('all');
  const[read,setRead]=useState<string[]>([]);
  useEffect(()=>{const t=window.setTimeout(()=>{try{const x=localStorage.getItem('ap-notif-read');if(x)setRead(JSON.parse(x));}catch{}},0);return()=>window.clearTimeout(t);},[]);
  const unread=useMemo(()=>notifications.filter(n=>!read.includes(n.id)).length,[notifications,read]);
  const shown=useMemo(()=>notifications.filter(n=>tab==='all'||n.kind===tab),[notifications,tab]);
  const counts=useMemo(()=>({all:notifications.length,error:notifications.filter(n=>n.kind==='error').length,success:notifications.filter(n=>n.kind==='success').length,info:notifications.filter(n=>n.kind==='info').length}),[notifications]);
  function markAll(){const ids=notifications.map(n=>n.id);const next=Array.from(new Set([...read,...ids]));setRead(next);try{localStorage.setItem('ap-notif-read',JSON.stringify(next));}catch{}}
  useEffect(()=>{const k=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);},[]);
  const navItems=<>{NAV.map(([href,label,icon])=><Link key={href} href={href} aria-current={path===href?'page':undefined} className={path===href?'ap-dash-active':''}><DIcon name={icon} size={16}/><span>{label}</span></Link>)}</>;
  return <div className="ap-dash">
    <aside className="ap-dash-side">
      <Link href="/" className="ap-dash-brand"><Image src="/automatepal-mark.svg" alt="" width={30} height={30}/><span>AutomatePal</span></Link>
      <nav aria-label="Workspace">{navItems}</nav>
      <div className="ap-dash-side-foot">
        <Link href="/sandbox-catalog"><DIcon name="catalog" size={14}/><span>Sandbox plans</span></Link>
        <Link href="/integrations"><DIcon name="audit" size={14}/><span>Audit / data</span></Link>
        <Link href="/operations"><DIcon name="audit" size={14}/><span>Logs</span></Link>
      </div>
    </aside>
    <div className="ap-dash-main">
      <header className="ap-dash-top">
        <p className="ap-dash-crumb">Workspace <span>›</span> {crumb}</p>
        {onSearch&&<label className="ap-dash-search"><DIcon name="search" size={14}/><input type="search" placeholder="Search this page" value={search??''} onChange={e=>onSearch(e.target.value)}/></label>}
        <Link href="/support" className="ap-dash-ask" title="Open the widget demo studio"><DIcon name="sparkles" size={14}/>Ask AI</Link>
        <button className="ap-dash-bell" aria-label={'Notifications'+(unread?` (${unread} unread)`:'')} onClick={()=>setOpen(true)}>
          <DIcon name="bell" size={16}/>{unread>0&&<span>{unread}</span>}
        </button>
      </header>
      <nav className="ap-dash-mobilenav" aria-label="Workspace">{navItems}</nav>
      <div className="ap-dash-body">{children}</div>
    </div>
    {open&&<>
      <div className="ap-dash-overlay" onClick={()=>setOpen(false)}/>
      <aside className="ap-dash-notifs" aria-label="Notifications">
        <div className="ap-dash-notifs-head">
          <h2>Notifications</h2>
          <div><button className="ap-dash-markall" onClick={markAll}>Mark all read</button><button className="ap-dash-close" aria-label="Close" onClick={()=>setOpen(false)}><DIcon name="x" size={15}/></button></div>
        </div>
        <div className="ap-dash-tabs" role="tablist">
          {(['all','error','success','info'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} onClick={()=>setTab(t)}>{t==='all'?'All':t==='error'?'Errors':t==='success'?'Success':'Info'} <span>{counts[t]}</span></button>)}
        </div>
        <div className="ap-dash-notifs-list">
          {!shown.length&&<p className="ap-dash-empty">No {tab==='all'?'':tab+' '}notifications from the loaded data.</p>}
          {shown.map(n=><article key={n.id} className={'ap-dash-notif'+(read.includes(n.id)?' ap-dash-read':'')}>
            <span className={'ap-dash-nicon ap-dash-n-'+n.kind}>{n.kind==='error'?<DIcon name="alert" size={14}/>:n.kind==='success'?<DIcon name="checkcircle" size={14}/>:<DIcon name="info" size={14}/>}</span>
            <div><h3>{n.title}</h3><p>{n.body}</p><small>{rel(n.ts)} · <b>{n.kind==='error'?'Error':n.kind==='success'?'Success':'Info'}</b></small></div>
          </article>)}
        </div>
        <p className="ap-dash-notifs-foot">Built only from the loaded workspace data. Nothing here is sent anywhere.</p>
      </aside>
    </>}
  </div>;
}
