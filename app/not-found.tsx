import Link from 'next/link';
import type {Metadata} from 'next';
import PublicShell from './components/PublicShell';

export const metadata:Metadata={title:'Page not found',description:'This page does not exist on AutomatePal.',robots:{index:false,follow:true}};

export default function NotFound(){return <PublicShell>
 <div className="ps-empty">
  <span className="ps-code" aria-hidden="true">404</span>
  <h1>This page doesn&apos;t exist</h1>
  <p>The link may be old or mistyped. Demo links also stop working after one hour.</p>
  <div className="ps-actions">
   <Link href="/" className="ps-btn">Back to home</Link>
   <Link href="/status" className="ps-btn ghost">Service status</Link>
   <Link href="/contact" className="ps-btn ghost">Contact</Link>
  </div>
 </div>
</PublicShell>;}
