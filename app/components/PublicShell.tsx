import {modeText} from '../../lib/app-mode';
import Link from 'next/link';
import Image from 'next/image';
import {COPYRIGHT_HOLDER,REPO_URL} from '../../lib/site';
import './public-shell.css';

/* Shared chrome for the public document pages (privacy, terms, security, contact, 404):
   brand header, one <main id="main-content"> for the skip link, and a legal footer. */
export default function PublicShell({children}:{children:React.ReactNode}){
 return <div className="ps">
  <header className="ps-top">
   <div className="ps-in">
    <Link href="/" className="ps-brand"><Image src="/automatepal-logo.png" alt="" width={46} height={23}/>AutomatePal</Link>
    <nav aria-label="Site">
     <Link href="/#features">Product</Link>
     <Link href="/pricing">Pricing</Link>
     <Link href="/security">Security</Link>
     <Link href="/contact">Contact</Link>
     <Link href="/login" className="ps-cta">Sign in</Link>
    </nav>
   </div>
  </header>
  <main id="main-content" className="ps-main">{children}</main>
  <footer className="ps-foot">
   <div className="ps-in">
    <p>© 2026 {COPYRIGHT_HOLDER}. {modeText('AutomatePal is a fictional-data preview. No live payments.','Billing stays read-only. No live payments.')}</p>
    <nav aria-label="Legal and trust">
     <Link href="/privacy">Privacy</Link>
     <Link href="/terms">Terms</Link>
     <Link href="/legal/dpa">DPA</Link>
     <Link href="/legal/subprocessors">Subprocessors</Link>
     <Link href="/security">Security</Link>
     <Link href="/status">Status</Link>
     <Link href="/contact">Contact</Link>
     <a href={REPO_URL} rel="noreferrer" target="_blank">GitHub</a>
    </nav>
   </div>
  </footer>
 </div>;
}

const fmt=(iso:string)=>new Date(iso+'T00:00:00Z').toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});

export function DocHead({kicker,title,lede,updated}:{kicker:string;title:string;lede?:React.ReactNode;updated?:string}){
 return <header className="ps-head">
  <p className="ps-kicker">{kicker}</p>
  <h1>{title}</h1>
  {lede&&<p className="ps-lede">{lede}</p>}
  {updated&&<p className="ps-updated">Last updated <time dateTime={updated}>{fmt(updated)}</time></p>}
 </header>;
}

/* Two-column document: sticky contents list beside the sections on wide screens. */
export function Doc({toc,children}:{toc:[string,string][];children:React.ReactNode}){
 return <div className="ps-doc">
  <nav className="ps-toc" aria-label="On this page"><p>On this page</p><ol>{toc.map(([id,label])=><li key={id}><a href={'#'+id}>{label}</a></li>)}</ol></nav>
  <div className="ps-body">{children}</div>
 </div>;
}
