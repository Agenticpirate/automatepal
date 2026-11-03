import {modeText} from '../../lib/app-mode';
import Link from 'next/link';
import type {Metadata} from 'next';
import PublicShell,{DocHead} from '../components/PublicShell';
import {CONTACT_EMAIL,REPO_URL} from '../../lib/site';

const description='How to reach the AutomatePal beta owner for support, data deletion, security and abuse reports.';
export const metadata:Metadata={title:'Contact and abuse reports',description,alternates:{canonical:'/contact'},
 openGraph:{title:'Contact and abuse reports | AutomatePal',description,url:'/contact',images:[{url:'/opengraph-image',width:1200,height:630,alt:modeText('AutomatePal fictional-data preview, no live payments','AutomatePal: source-backed support, no live payments')}]},
 twitter:{card:'summary_large_image',title:'Contact and abuse reports | AutomatePal',description,images:['/opengraph-image']}};

export default function Contact(){return <PublicShell>
 <DocHead kicker="Contact" title="Contact and abuse reports" lede="AutomatePal is a one-person experimental beta. All contact is handled manually; there is no support team, guaranteed response time or service-level agreement."/>
 <div className="ps-body">
  <div className="ps-grid">
   <section className="ps-card" aria-labelledby="c-owner"><h2 id="c-owner">Reach the owner</h2>
    <p>Email <a href={'mailto:'+CONTACT_EMAIL}>{CONTACT_EMAIL}</a> for support questions, account or stored-activity deletion requests, and privacy concerns. Send deletion requests from the email address linked to your account so ownership can be checked. Deletion is handled manually; no completion time is promised.</p>
    <p>The source code and public project notes are on <a href={REPO_URL} rel="noreferrer" target="_blank">GitHub</a>.</p>
   </section>
   <section className="ps-card" aria-labelledby="c-abuse"><h2 id="c-abuse">Report abuse or a security issue</h2>
    <p>Email the same address with the subject line starting <span className="ps-mono">[abuse]</span> or <span className="ps-mono">[security]</span>. Include the page or demo-link URL, what you observed, and when. Do not include passwords, API keys, card numbers or other people&apos;s personal data in the report.</p>
    <p>Abuse covers misuse of a demo widget or link, attempts to bypass quotas or isolation, and prohibited content in uploaded sources. Security reports cover suspected vulnerabilities. Reports are reviewed manually; a confirmation or fix timeline is not promised. Good-faith security research reported this way will not be treated as hostile.</p>
   </section>
  </div>
  <section className="ps-card" aria-labelledby="c-not"><h2 id="c-not">What not to send</h2>
   <p>Never email or paste real customer details, payment credentials or sensitive business data. {modeText('This beta works with fictional data only - see the','Read how data is handled in the')} <Link href="/privacy">privacy notice</Link> and <Link href="/terms">beta terms</Link>. Current service state is on the <Link href="/status">status page</Link>. Security controls and the vulnerability-reporting policy are on the <Link href="/security">security page</Link>.</p>
  </section>
 </div>
</PublicShell>;}
