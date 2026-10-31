'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import DeskShell from '../components/DeskShell';
import {authHeaders,browserAuth,selectWorkspace} from '../../lib/browser-auth';

/* Invite acceptance. The token arrives in the URL fragment (never sent to the server in the
   page request) and is kept in sessionStorage so it survives a sign-in round trip. */
const KEY='ap-pending-invite';
const TOKEN=/^ap_inv_[a-f0-9]{64}$/;
type State='checking'|'signin'|'ready'|'accepting'|'done'|'error'|'missing';

export default function Invite(){
 const[state,setState]=useState<State>('checking');
 const[message,setMessage]=useState('');
 const[token,setToken]=useState('');
 useEffect(()=>{let on=true;void Promise.resolve().then(async()=>{
  const fromHash=location.hash.slice(1);
  let t='';try{t=TOKEN.test(fromHash)?fromHash:(sessionStorage.getItem(KEY)??'');if(TOKEN.test(fromHash))sessionStorage.setItem(KEY,fromHash);}catch{t=TOKEN.test(fromHash)?fromHash:'';}
  if(TOKEN.test(fromHash))history.replaceState(null,'',location.pathname);
  if(!on)return;
  if(!TOKEN.test(t)){setState('missing');return;}
  setToken(t);
  const s=await browserAuth()?.auth.getSession();
  if(on)setState(s?.data.session?'ready':'signin');
 });return()=>{on=false;};},[]);
 async function accept(){
  setState('accepting');
  try{
   const r=await fetch('/api/team',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({action:'accept',token})});
   const j=await r.json();
   if(j.error){setMessage(j.error==='Invite unavailable'?'This invite was already used, revoked or expired, or it was sent to a different email address than the one you signed in with.':j.error);setState('error');return;}
   try{sessionStorage.removeItem(KEY);}catch{}
   selectWorkspace(j.workspace);setState('done');
   window.setTimeout(()=>{window.location.assign(new URL('/owner',window.location.origin));},900);
  }catch{setMessage('Request failed. Try again.');setState('error');}
 }
 const copy:Record<State,[string,string]>={
  checking:['Checking your invite…',''],
  missing:['No invite found','Open the full invite link you were sent. It ends with a long code after the # sign.'],
  signin:['Sign in to join','Sign in with the email address the invite was sent to, then open the invite link again.'],
  ready:['You have been invited','Joining gives you access to this team workspace with the role chosen by the person who invited you.'],
  accepting:['Joining…',''],
  done:['You are on the team','Taking you to the workspace overview.'],
  error:['Could not join',message],
 };
 const[title,body]=copy[state];
 return <DeskShell widget><main className="ap-public ap-auth"><div className="ap-auth-band">
  <nav className="ap-auth-nav" aria-label="Invite"><Link href="/" className="ap-mark">AutomatePal</Link><Link href="/" className="ap-auth-back">Back to home ↗</Link></nav>
  <section className="ap-auth-card">
   <p className="ap-kicker ap-m-up">Team invite</p>
   <h1 className="ap-m-up" style={{'--i':1} as React.CSSProperties}>{title}</h1>
   {body&&<p className="ap-m-up" style={{'--i':2} as React.CSSProperties}>{body}</p>}
   {state==='ready'&&<button className="ap-solid ap-m-up" style={{'--i':3,marginTop:20,padding:'12px 20px'} as React.CSSProperties} onClick={()=>void accept()}>Accept invite</button>}
   {state==='signin'&&<Link className="ap-solid ap-m-up" style={{'--i':3,display:'inline-block',marginTop:20,padding:'12px 20px'} as React.CSSProperties} href="/login">Sign in</Link>}
   {state==='error'&&<Link className="ap-text-link" style={{display:'inline-block',marginTop:18}} href="/team">Go to your team page ↗</Link>}
  </section>
 </div></main></DeskShell>;
}
