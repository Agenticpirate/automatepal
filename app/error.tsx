'use client';
import Link from 'next/link';
import PublicShell from './components/PublicShell';

/* Route-level crash screen. Shows no stack trace or error text; the digest lets the owner match server logs. */
export default function RouteError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
 return <PublicShell>
  <div className="ps-empty" role="alert">
   <span className="ps-code" aria-hidden="true">!</span>
   <h1>Something went wrong</h1>
   <p>This page hit an unexpected error. Nothing was sent or charged. Try again, and if it keeps happening, check the status page.</p>
   {error.digest&&<p><span className="ps-mono">Reference {error.digest}</span></p>}
   <div className="ps-actions">
    <button type="button" className="ps-btn" onClick={reset}>Try again</button>
    <Link href="/status" className="ps-btn ghost">Service status</Link>
    <Link href="/" className="ps-btn ghost">Home</Link>
   </div>
  </div>
 </PublicShell>;
}
