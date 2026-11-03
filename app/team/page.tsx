'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import DeskShell from '../components/DeskShell';
import DashShell,{DIcon} from '../components/DashShell';
import {authHeaders,selectWorkspace,selectedWorkspace} from '../../lib/browser-auth';
import './team.css';

type Role='owner'|'admin'|'manager'|'agent';
type Member={user_id:string;email:string;role:Role;joined_at:string;is_you:boolean};
type Invite={id:string;email:string;role:Exclude<Role,'owner'>;created_at:string;expires_at:string};
type Workspace={workspace_id:string;role:Role;owner_email:string;joined_at:string};
type Data={me:{id:string;email?:string};workspaces:Workspace[];current:{workspace_id:string;role:Role}|null;team?:Member[];invites?:Invite[];workspaceInvalid?:boolean;demo?:boolean;error?:string};

const RANK:Record<Role,number>={owner:4,admin:3,manager:2,agent:1};
const LABEL:Record<Role,string>={owner:'Owner',admin:'Admin',manager:'Manager',agent:'Agent'};
const ROLE_HINT:Record<Exclude<Role,'owner'>,string>={agent:'Works tickets',manager:'Edits content',admin:'Runs the workspace'};
const SEATS=25;
// What each role can do. Mirrors the database gates in db/043_workspace_members.sql.
const MATRIX:[string,string,Role][]=[
 ['View tickets, knowledge and the widget','Read-only for everyone on the team','agent'],
 ['Work tickets','Notes, status, priority, take over, assign','agent'],
 ['Edit knowledge and custom answers','Import, publish, delete sources','manager'],
 ['Change widget settings','Branding, starters, allowed sites','manager'],
 ['Decide refund reviews','Recorded decision only, no money moves','manager'],
 ['Notification rules and logs','Alert rules, operations log, PayPal activity','manager'],
 ['Invite agents','','manager'],
 ['Invite managers','','admin'],
 ['API tokens, webhooks and audit log','Sandbox catalog and AI studio too','admin'],
 ['Invite and manage admins','','owner'],
 ['Delete workspace data','Removes the team as well','owner'],
];
const PALETTE=['#09318D','#041A52','#E25FAE','#0B3CA8','#A3226F','#1F4FBF'];
const color=(s:string)=>PALETTE[[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7)%PALETTE.length];
const initials=(email:string)=>{const n=email.split('@')[0].split(/[._-]+/).filter(Boolean);return ((n[0]?.[0]??'?')+(n[1]?.[0]??'')).toUpperCase();};
const date=(s:string)=>new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
function RoleBadge({role}:{role:Role}){return <span className={'tm-role tm-role-'+role}><i aria-hidden="true"/>{LABEL[role]}</span>;}

export default function Team(){
 const[d,setD]=useState<Data|null>(null);
 const[status,setStatus]=useState<{text:string;error?:boolean}>({text:''});
 const[busy,setBusy]=useState(false);
 const[email,setEmail]=useState('');
 const[role,setRole]=useState<Exclude<Role,'owner'>>('agent');
 const[link,setLink]=useState('');
 const[copied,setCopied]=useState(false);

 const load=useCallback(async()=>{
  try{
   const r=await fetch('/api/team',{headers:await authHeaders()});const j:Data=await r.json();
   if(j.workspaceInvalid&&selectedWorkspace()){selectWorkspace(null);location.reload();return;}
   setD(j);if(j.error)setStatus({text:j.error,error:true});
  }catch{setStatus({text:'Could not load the team.',error:true});}
 },[]);
 useEffect(()=>{const t=window.setTimeout(()=>{void load();},0);return()=>window.clearTimeout(t);},[load]);

 const myRole:Role=d?.current?.role??'agent';
 const canInvite=RANK[myRole]>=RANK.manager&&!d?.demo;
 const team=useMemo(()=>d?.team??[],[d]);
 const invites=useMemo(()=>d?.invites??[],[d]);
 const used=team.length+invites.length;
 const counts=useMemo(()=>({leads:team.filter(m=>m.role==='admin'||m.role==='manager').length,agents:team.filter(m=>m.role==='agent').length}),[team]);
 const currentWs=d?.workspaces.find(w=>w.workspace_id===d?.current?.workspace_id);

 async function act(body:Record<string,unknown>,after?:(j:Record<string,string>)=>void){
  setBusy(true);setStatus({text:''});
  try{
   const r=await fetch('/api/team',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify(body)});
   const j=await r.json();
   setStatus(j.error?{text:j.error,error:true}:{text:j.note??'Done.'});
   if(!j.error){after?.(j);await load();}
  }catch{setStatus({text:'Request failed. Try again.',error:true});}
  finally{setBusy(false);}
 }
 function invite(e:React.FormEvent){e.preventDefault();setLink('');setCopied(false);void act({action:'invite',email,role},j=>{setLink(j.link??'');setEmail('');});}
 async function copy(){try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setCopied(false);}}
 function switchTo(ws:string){selectWorkspace(ws===d?.me.id?null:ws);window.location.assign(new URL('/owner',window.location.origin));}

 // Agents cannot see invites, so they get their own role instead of a misleading zero.
 const kpis:[string,number|string,string][]=[['Members',team.length,'Including you'],RANK[myRole]>=RANK.manager?['Pending invites',invites.length,'Expire after 7 days']:['Your role',LABEL[myRole],'Works the ticket queue'],['Admins and managers',counts.leads,'Can change content'],['Agents',counts.agents,'Work the queue']];

 return <DeskShell widget><DashShell crumb="Team">
  <div className="tm">
   <div className="tm-head ap-dash-headrow">
    <div>
     <p className="ap-dash-kicker">Workspace · Team</p>
     <h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Your team</span></span></h1>
     <p className="ap-dash-sub">Invite teammates and give each person the access their job needs. Every change is recorded in the audit log with who made it.</p>
    </div>
    {d?.current&&<div className="tm-you">
     <div className="tm-seats"><span>{used} of {SEATS} seats used</span><i aria-hidden="true"><b style={{width:`${Math.min(100,used/SEATS*100)}%`}}/></i></div>
     <RoleBadge role={myRole}/>
    </div>}
   </div>

   {d?.error&&<p className="ap-dash-note-warn">{d.error}</p>}
   {!d&&<div className="ap-dash-card"><p className="ap-dash-muted">Loading team…</p></div>}

   {d?.current&&<>
    <div className="ap-dash-kpis">{kpis.map(([h,v,c])=><div key={h} className="ap-dash-kpi"><h3>{h}</h3><p>{v}</p><span className="ap-dash-chip">{c}</span></div>)}</div>

    <div className="tm-grid">
     <section className="ap-dash-card" aria-labelledby="tm-members">
      <div className="tm-card-head"><h2 id="tm-members" className="ap-dash-h2">Members</h2><span className="ap-dash-muted">{currentWs?`Workspace of ${currentWs.owner_email}`:''}</span></div>
      <ul className="tm-list">
       {team.map((m,i)=>{const manageable=!d.demo&&!m.is_you&&m.role!=='owner'&&RANK[m.role]<RANK[myRole];return <li key={m.user_id} className="tm-member" style={{'--i':i} as React.CSSProperties}>
        <span className="tm-avatar" style={{background:color(m.email)}} aria-hidden="true">{initials(m.email)}</span>
        <div className="tm-who"><strong><span>{m.email}</span>{m.is_you&&<em className="tm-youchip">You</em>}</strong><small>{m.role==='owner'?'Owner since':'Joined'} {date(m.joined_at)}</small></div>
        <div className="tm-member-role">{manageable?<select className="tm-select" aria-label={`Role for ${m.email}`} value={m.role} disabled={busy} onChange={e=>void act({action:'set_role',user:m.user_id,role:e.target.value})}>
         {(['agent','manager','admin'] as const).filter(r=>RANK[r]<RANK[myRole]).map(r=><option key={r} value={r}>{LABEL[r]}</option>)}
        </select>:<RoleBadge role={m.role}/>}</div>
        {manageable?<button className="tm-icon-btn" aria-label={`Remove ${m.email}`} title="Remove from team" disabled={busy} onClick={()=>{if(confirm(`Remove ${m.email} from this workspace? Their ticket assignments are cleared.`))void act({action:'remove',user:m.user_id});}}><DIcon name="x" size={14}/></button>:<span className="tm-icon-gap" aria-hidden="true"/>}
       </li>;})}
      </ul>
     </section>

     <div className="tm" style={{gap:18}}>
      <section className="ap-dash-card" aria-labelledby="tm-invite">
       <h2 id="tm-invite" className="ap-dash-h2">Invite a teammate</h2>
       <p className="ap-dash-muted">When email is set up on this server, we email the invite to them. You also see the private link once, so you can share it yourself.</p>
       {canInvite?<form className="tm-form" onSubmit={invite}>
        <label className="tm-label">Work email<input className="tm-input" type="email" required maxLength={254} placeholder="name@company.com" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <div className="tm-label" role="group" aria-label="Role">Role
         <div className="tm-seg">{(['agent','manager','admin'] as const).map(r=><button type="button" key={r} aria-pressed={role===r} disabled={RANK[r]>=RANK[myRole]} onClick={()=>setRole(r)}><b>{LABEL[r]}</b><small>{ROLE_HINT[r]}</small></button>)}</div>
        </div>
        <button className="ap-dash-btn tm-cta" disabled={busy||!email}>Create invite link</button>
       </form>:<p className="tm-empty">{d.demo?'Read-only demo. Sign in to invite your own team.':'Ask a manager, admin or the owner to invite people.'}</p>}
       {link&&<div className="tm-link" role="status">
        <p>Shown once. It works for 7 days, only for that email address, and only after they sign in.</p>
        <div><code>{link}</code><button className="tm-copy" onClick={()=>void copy()}>{copied?'Copied':'Copy'}</button></div>
       </div>}
       <p className="tm-status" role="status" data-error={status.error?'true':'false'}>{link&&!status.error?'':status.text}</p>
      </section>

      {RANK[myRole]>=RANK.manager&&<section className="ap-dash-card" aria-labelledby="tm-pending">
       <h2 id="tm-pending" className="ap-dash-h2">Pending invites</h2>
       {!invites.length?<p className="tm-empty" style={{marginTop:10}}>No open invites.</p>:<div style={{marginTop:6}}>{invites.map(v=><div key={v.id} className="tm-invite">
        <div><strong>{v.email}</strong><small>{LABEL[v.role]} · expires {date(v.expires_at)}</small></div>
        <button className="ap-dash-btn ap-dash-btn-ghost" disabled={busy||d.demo||RANK[v.role]>=RANK[myRole]} onClick={()=>void act({action:'revoke_invite',id:v.id})}>Revoke</button>
       </div>)}</div>}
      </section>}
     </div>
    </div>

    <section className="ap-dash-card" aria-labelledby="tm-perms">
     <div className="tm-card-head"><h2 id="tm-perms" className="ap-dash-h2">What each role can do</h2><span className="ap-dash-muted">Enforced by the database, not just hidden in the UI.</span></div>
     <div style={{overflowX:'auto'}}><table className="tm-matrix">
      <thead><tr><th scope="col">Capability</th>{(['agent','manager','admin','owner'] as const).map(r=><th key={r} scope="col" className={r===myRole?'tm-col-you':undefined}>{LABEL[r]}</th>)}</tr></thead>
      <tbody>{MATRIX.map(([cap,hint,min])=><tr key={cap}><td>{cap}{hint&&<small>{hint}</small>}</td>{(['agent','manager','admin','owner'] as const).map(r=><td key={r} className={r===myRole?'tm-col-you':undefined}>{RANK[r]>=RANK[min]?<span className="tm-yes" aria-label="Allowed"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>:<span className="tm-no" aria-label="Not allowed"/>}</td>)}</tr>)}</tbody>
     </table></div>
    </section>

    {d.workspaces.length>0&&<section className="ap-dash-card" aria-labelledby="tm-ws">
     <h2 id="tm-ws" className="ap-dash-h2">Workspaces you belong to</h2>
     <div style={{marginTop:6}}>{d.workspaces.map(w=>{const here=w.workspace_id===d.current?.workspace_id;return <div key={w.workspace_id} className="tm-ws">
      <div><strong>{w.role==='owner'?'Your workspace':w.owner_email}</strong><RoleBadge role={w.role}/></div>
      <div className="tm-ws-actions">
       {here?<span className="ap-dash-badge ap-dash-b-info">Current</span>:<button className="ap-dash-btn ap-dash-btn-ghost" disabled={d.demo} onClick={()=>switchTo(w.workspace_id)}>Switch</button>}
       {w.role!=='owner'&&<button className="ap-dash-btn ap-dash-btn-ghost" disabled={busy||d.demo} onClick={()=>{if(confirm(`Leave the workspace of ${w.owner_email}?`))void act({action:'leave',workspace:w.workspace_id},()=>{if(here){selectWorkspace(null);location.reload();}});}}>Leave</button>}
      </div>
     </div>;})}</div>
    </section>}
    <p className="tm-note">Invite links are shown once and stored only as a hash. Seats are a preview limit of {SEATS} per workspace, not a paid entitlement. <Link href="/integrations">Audit log ↗</Link></p>
   </>}
  </div>
 </DashShell></DeskShell>;
}
