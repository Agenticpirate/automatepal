import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../../components/PublicShell';
import {LEGAL,LEGAL_UPDATED} from '../../../lib/legal';
import {legalMeta} from '../meta';
export const metadata=legalMeta('/legal/dpa','Data processing addendum','How AutomatePal processes personal data on behalf of businesses that use it: roles, instructions, security, subprocessors, deletion and assistance.');
const TOC:[string,string][]=[['parties','Parties and roles'],['scope','Scope of processing'],['instructions','Instructions'],['security','Security measures'],['subprocessors','Subprocessors'],['transfers','International transfers'],['assistance','Assistance and breaches'],['deletion','Return and deletion'],['audit','Information and audits'],['sign','Signing']];
export default function Dpa(){return <PublicShell>
 <DocHead kicker="Legal" title="Data processing addendum" updated={LEGAL_UPDATED} lede="This addendum forms part of the terms of service when a business uses AutomatePal to process its visitors' personal data."/>
 <Doc toc={TOC}>
  <section id="parties"><h2>Parties and roles</h2>
   <p>The business that owns an AutomatePal workspace is the controller of its visitors&apos; personal data. {LEGAL.entity} (&quot;AutomatePal&quot;) is the processor and processes that data only to provide the service.</p>
  </section>
  <section id="scope"><h2>Scope of processing</h2>
   <ul>
    <li><strong>Data subjects:</strong> the controller&apos;s website visitors and team members.</li>
    <li><strong>Data:</strong> visitor questions, AI answers, messages, requests, contact addresses given with consent, billing references a visitor gives for a lookup, and team members&apos; account emails.</li>
    <li><strong>Purpose:</strong> answering visitors from the controller&apos;s published sources, handing conversations to a person, read-only billing lookups, analytics and notifications for the controller.</li>
    <li><strong>Duration:</strong> while the workspace exists; transcripts for the retention the controller chooses (30, 90 or 365 days).</li>
   </ul>
  </section>
  <section id="instructions"><h2>Instructions</h2>
   <p>AutomatePal processes personal data only on the controller&apos;s documented instructions, which are these terms and the settings the controller chooses in the app, unless the law requires otherwise. People authorised to process the data are bound by confidentiality.</p>
  </section>
  <section id="security"><h2>Security measures</h2>
   <p>The measures in place are described on the <Link href="/security">security page</Link>, including encryption in transit, row-level isolation between workspaces, role-based access, encrypted billing credentials, metadata-only audit and email logs, and a strict content security policy. AutomatePal holds no SOC 2, ISO 27001 or HIPAA certification.</p>
  </section>
  <section id="subprocessors"><h2>Subprocessors</h2>
   <p>The controller authorises the subprocessors on the <Link href="/legal/subprocessors">subprocessor list</Link>. AutomatePal updates that list before a new subprocessor processes customer data, so the controller can object; if an objection cannot be resolved, the controller may stop using the service.</p>
  </section>
  <section id="transfers"><h2>International transfers</h2>
   <p>The database runs in the United States (AWS us-east-1) and several subprocessors process data in the United States. Where the law requires a transfer mechanism, for example standard contractual clauses, it is set out in the signed agreement; ask {LEGAL.contactEmail} for a copy.</p>
  </section>
  <section id="assistance"><h2>Assistance and breaches</h2>
   <p>AutomatePal helps the controller answer data subject requests, mainly through the in-app export and deletion tools, and tells the controller without undue delay after becoming aware of a personal data breach affecting its data.</p>
  </section>
  <section id="deletion"><h2>Return and deletion</h2>
   <p>The controller can export its data and delete it at any time from the app. What is deleted and kept is listed on the <Link href="/legal/delete-account">account deletion page</Link>. Backups held by the database provider expire on that provider&apos;s schedule.</p>
  </section>
  <section id="audit"><h2>Information and audits</h2>
   <p>AutomatePal makes available the information needed to show compliance with this addendum, through this page, the security page and written answers to reasonable questions sent to {LEGAL.contactEmail}.</p>
  </section>
  <section id="sign"><h2>Signing</h2>
   <p>This addendum applies automatically under the terms of service. A countersigned copy can be requested from {LEGAL.contactEmail}. Provider signatory: {LEGAL.dpaContact}. Governing law: {LEGAL.governingLaw}.</p>
  </section>
 </Doc>
</PublicShell>;}
