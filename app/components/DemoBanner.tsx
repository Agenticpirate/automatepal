'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {browserAuth} from '../../lib/browser-auth';

/* Shown on app surfaces while the open demo preview flag is on and the visitor has no
   session. Mounted by DeskShell and the standalone studio pages. */
export default function DemoBanner(){
 const [show,setShow]=useState(false);
 useEffect(()=>{let on=true;void Promise.resolve().then(async()=>{if(process.env.NEXT_PUBLIC_DEMO_OPEN==='false')return;const s=await browserAuth()?.auth.getSession();if(on&&!s?.data.session)setShow(true);});return()=>{on=false};},[]);
 if(!show)return null;
 return <div className="ap-demo-banner" role="note">Open demo preview - fictional data, read-only, nothing sends. <Link href="/login">Sign in</Link> for your own workspace.</div>;
}
