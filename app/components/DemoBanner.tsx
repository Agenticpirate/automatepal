'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {browserAuth} from '../../lib/browser-auth';

/* Shown only on app surfaces that serve the in-repo fictional fixtures, while the open demo
   preview flag is on and the visitor has no session. Public marketing pages never show it. */
const APP_SURFACES=['/owner','/tickets','/knowledge','/support','/setup','/team','/operations','/dashboard','/integrations','/sandbox-catalog','/workspace','/proof'];
export default function DemoBanner(){
 const path=usePathname()??'';
 const onApp=APP_SURFACES.some(p=>path===p||path.startsWith(p+'/'));
 const [show,setShow]=useState(false);
 useEffect(()=>{let on=true;void Promise.resolve().then(async()=>{if(process.env.NEXT_PUBLIC_DEMO_OPEN==='false')return;const s=await browserAuth()?.auth.getSession();if(on&&!s?.data.session)setShow(true);});return()=>{on=false};},[]);
 if(!show||!onApp)return null;
 // Inline styles: app pages load different stylesheets, so the banner must not depend on any of them.
 return <div className="ap-demo-banner" role="note" style={{position:'sticky',top:0,zIndex:60,padding:'8px 14px',background:'#FD91CC',color:'#041A52',fontSize:12,fontWeight:600,lineHeight:1.4,textAlign:'center',borderBottom:'2px solid #041A52',fontFamily:"var(--font-geist-sans),'Inter',system-ui,sans-serif"}}>Open demo preview - fictional data, read-only, nothing sends. <Link href="/login" style={{color:'#09318D',textDecoration:'underline'}}>Sign in</Link> for your own workspace.</div>;
}
