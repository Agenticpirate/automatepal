import {modeText} from '../../lib/app-mode';
import Link from 'next/link';
import type {Metadata} from 'next';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';
import {CONTACT_EMAIL,SITE_URL} from '../../lib/site';
import {SUBPROCESSORS} from '../../lib/legal';
import {isProduction} from '../../lib/app-mode';

/* Trust page. Every control listed here is implemented and covered by the repo's checks
   (HARDENING.md, FEATURES.md, scripts/verify-*). Gaps are listed as plainly as the controls.
   Update this page whenever a control or provider changes. */
const description='Security controls, service providers and vulnerability reporting for AutomatePal, including what is not in place yet.';
export const metadata:Metadata={title:'Security',description,alternates:{canonical:'/security'},robots:{index:true,follow:true},
 openGraph:{title:'Security | AutomatePal',description,url:'/security',images:[{url:'/opengraph-image',width:1200,height:630,alt:modeText('AutomatePal fictional-data preview, no live payments','AutomatePal: source-backed support, no live payments')}]},
 twitter:{card:'summary_large_image',title:'Security | AutomatePal',description,images:['/opengraph-image']}};

const TOC:[string,string][]=[['glance','At a glance'],['isolation','Workspace isolation'],['access','Access and secrets'],['data','Data handling'],['app','Application security'],['infra','Infrastructure'],['subprocessors','Service providers'],['gaps','Not in place yet'],['report','Report a vulnerability']];
type S='ok'|'no'|'part';
const GLANCE:[string,S,string,string][]=[
 ['Encryption in transit','ok','In place','HTTPS only, with HSTS on every response.'],
 ['Encryption at rest','ok','Provider','Supabase encrypts stored data at rest.'],
 ['Tenant isolation','ok','In place','Postgres row-level security, tested with two populated workspaces.'],
 ['Payment execution','no','Off','Billing lookups are read-only. No live payments, captures or refunds.'],
 ['SOC 2 / ISO 27001','no','Not held','No third-party attestation yet.'],
 ['HIPAA / BAA','no','Not offered','Do not store health information.'],
 ['DPA','ok','Available','A data processing addendum is published; company details are still being completed.'],
 ['Content Security Policy','ok','In place','A fresh nonce per response with strict-dynamic; no inline or outside scripts run.'],
 ['Penetration test','no','Not done','No independent test has been run.'],
];
const PROVIDERS:[string,string,string,string][]=SUBPROCESSORS.map(p=>[p.name,p.purpose,p.data,p.location]);

export default function Security(){return <PublicShell>
 <DocHead kicker="Trust" title="Security at AutomatePal" updated="2026-11-02" lede={isProduction()?"What protects workspaces today, who processes data, and what is not in place yet. Nothing here is a third-party certification.":"What protects workspaces today, who processes data, and what is not in place yet. AutomatePal is a fictional-data preview, so treat everything here as preview controls, not a production assurance."}/>
 <Doc toc={TOC}>
  <section id="glance"><h2>At a glance</h2>
   <div className="ps-scroll" role="region" aria-label="Security status table" tabIndex={0}><table className="ps-table"><thead><tr><th scope="col">Area</th><th scope="col">Status</th><th scope="col">Detail</th></tr></thead>
    <tbody>{GLANCE.map(([area,s,label,detail])=><tr key={area}><td>{area}</td><td><span className={'ps-status '+s}>{label}</span></td><td>{detail}</td></tr>)}</tbody></table></div>
  </section>

  <section id="isolation"><h2>Workspace isolation</h2>
   <p>Every workspace&apos;s rows live in the same Postgres database and are separated by row-level security, so a signed-in user&apos;s queries only see their own workspace&apos;s data. Database functions check the caller before they read or change anything.</p>
   <p>Automated tests run two synthetic workspaces side by side, each with cases, published and private knowledge, tokens and audit events. They confirm that one workspace cannot read, overwrite, revoke or delete the other&apos;s data, and that deleting one leaves the other intact.</p>
  </section>

  <section id="access"><h2>Access and secrets</h2>
   <ul>
    <li><strong>Sign-in</strong> uses Google or an email sign-in link through Supabase Auth. The app accepts only confirmed email addresses and never sees your Google password.</li>
    <li><strong>API tokens</strong> are shown once, stored only as a SHA-256 hash, scoped to support, analytics or health data, expire after 1 to 168 hours, can be revoked, and are capped at five active per workspace. They read metadata only.</li>
    <li><strong>Webhooks</strong> are signed with HMAC-SHA256 over the timestamp and the raw body. The signing key cannot be read back from the browser. Deliveries resolve the destination to a public address, refuse redirects and are size- and time-limited.</li>
    <li><strong>Demo links</strong> expire after one hour.</li>
   </ul>
  </section>

  <section id="data"><h2>Data handling</h2>
   <ul>
    <li>Answers come only from sources you published, and source text is sent for AI processing only after you consent.</li>
    <li>Owner actions are recorded in an audit log that keeps IDs, resource type, operation and time only, never message text, contact details, URLs or secrets. The latest 1,000 events are kept per workspace.</li>
    <li>Operational logs hold error codes and timings, not message text or personal data. They are visible for 7 days.</li>
    <li>Owners can delete their preview data themselves after typing a confirmation. What this does and does not remove is listed in the <Link href="/privacy#deletion">privacy notice</Link>.</li>
   </ul>
  </section>

  <section id="app"><h2>Application security</h2>
   <ul>
    <li>API inputs are validated against schemas with body-size caps, and writes check the request origin.</li>
    <li>A per-identity rate guard limits repeated writes, and answer budgets (20 per conversation, 100 per workspace per day) are enforced before any AI call.</li>
    <li>Responses carry HSTS, a Content Security Policy with a fresh nonce per response and <code>strict-dynamic</code> that blocks inline and outside scripts and plugins, <code>nosniff</code>, a no-referrer policy and a permissions policy that disables camera, microphone, location and payment APIs. Pages refuse to be framed by other sites, except the support widget frame that customers embed.</li>
    <li>Private pages and APIs are never cached and are kept out of search engines.</li>
    <li>The dependency audit reported no known vulnerabilities at the last check on October 31, 2026.</li>
   </ul>
  </section>

  <section id="infra"><h2>Infrastructure</h2>
   <p>The app runs on Cloudflare Workers. Sign-in and the database run on Supabase in AWS us-east-1. Supabase states that customer data is encrypted at rest with AES-256 and in transit with TLS (<a href="https://supabase.com/security" rel="noreferrer" target="_blank">Supabase security</a>). Payment calls are locked to PayPal&apos;s sandbox; the server refuses any other PayPal address.</p>
  </section>

  <section id="subprocessors"><h2>Service providers</h2>
   <p>These providers process data so AutomatePal can work. Each has its own terms and privacy policy.</p>
   <div className="ps-scroll" role="region" aria-label="Service providers table" tabIndex={0}><table className="ps-table"><thead><tr><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Data</th><th scope="col">Location</th></tr></thead>
    <tbody>{PROVIDERS.map(([name,purpose,data,where])=><tr key={name}><td>{name}</td><td>{purpose}</td><td>{data}</td><td>{where}</td></tr>)}</tbody></table></div>
   <p>Billing providers receive data only when an owner connects their own account. The full list with when each provider is used is on the <Link href="/legal/subprocessors">subprocessor list</Link>; the <Link href="/legal/dpa">data processing addendum</Link> covers how we process data for you. Free-tier Gemini content may be used by Google to improve its products.</p>
  </section>

  <section id="gaps"><h2>Not in place yet</h2>
   <p>These are open gaps, not plans with dates:</p>
   <ul>
    <li>No SOC 2, ISO 27001, HIPAA or GDPR certification and no BAA. The data processing addendum still has company details to complete.</li>
    <li>No independent penetration test.</li>
    <li>Hosting is on free tiers: the app can sleep or restart, there is no uptime SLA, and the database has no managed daily backups or point-in-time recovery. A restore has not been rehearsed.</li>
    <li>No single sign-on (SAML or OIDC) and no multi-factor authentication beyond what your Google account enforces.</li>
    <li>Monitoring is an automated uptime check every 10 minutes and a metadata-only server error log with an optional burst alert. There is no 24/7 on-call; one maintainer reviews reports manually.</li>
   </ul>
  </section>

  <section id="report"><h2>Report a vulnerability</h2>
   <p>Email <a href={'mailto:'+CONTACT_EMAIL+'?subject=%5Bsecurity%5D%20'}>{CONTACT_EMAIL}</a> with a subject line starting <span className="ps-mono">[security]</span>. Include the affected page or demo-link URL, what you observed and when. Do not include secrets, credentials or other people&apos;s personal data.</p>
   <p>Reports are reviewed manually by one maintainer. No response time or fix timeline is promised. Good-faith research reported this way will not be treated as hostile. Please test only against your own workspace and {modeText('fictional data','test data')}.</p>
   <p>The machine-readable policy is at <a href="/.well-known/security.txt">/.well-known/security.txt</a> (<a href={SITE_URL+'/.well-known/security.txt'}>canonical copy</a>). It lists the contact address above, this section as the policy, its expiry date and English as the preferred language.</p>
  </section>
 </Doc>
</PublicShell>;}
