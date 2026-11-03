import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../../components/PublicShell';
import {LEGAL,LEGAL_UPDATED} from '../../../lib/legal';
import {legalMeta} from '../meta';
export const metadata=legalMeta('/legal/delete-account','Deleting your account and data','What happens to your AutomatePal workspace data and sign-in account when you delete them, and what is kept.');
const TOC:[string,string][]=[['steps','How to delete'],['deleted','What is deleted'],['kept','What is kept'],['visitors','Visitors'],['account','Your sign-in account']];
export default function DeleteAccount(){return <PublicShell>
 <DocHead kicker="Legal" title="Deleting your account and data" updated={LEGAL_UPDATED} lede="You can export and delete your workspace data yourself. This page lists exactly what is removed and what stays."/>
 <Doc toc={TOC}>
  <section id="steps"><h2>How to delete</h2>
   <ol>
    <li>Sign in as the workspace owner and open <strong>Integrations &gt; Audit and data controls</strong>.</li>
    <li>Optional: choose <strong>Export workspace data (JSON)</strong> to keep a copy of your conversations, sources, responses, leads and settings.</li>
    <li>Type <span className="ps-mono">DELETE MY PREVIEW DATA</span> and choose <strong>Permanently delete preview data</strong>. It cannot be undone.</li>
   </ol>
   <p>Uncertain or executing actions must be reconciled first; deletion refuses until they are. To delete one conversation instead, use Chat history.</p>
  </section>
  <section id="deleted"><h2>What is deleted</h2>
   <ul>
    <li>Conversations, full transcripts, tickets, ticket history, requests, person-chat messages and AI labels.</li>
    <li>Knowledge sources, chunks, custom responses, import history and the scheduled-refresh queue.</li>
    <li>Consented visitor contact addresses (leads).</li>
    <li>Widget, email, retention, refresh and insight settings.</li>
    <li>API and MCP tokens, webhooks, billing provider connections with their encrypted credentials, billing lookups and verifications.</li>
    <li>Team members and pending invites, the email log, operational logs and the owner audit history.</li>
   </ul>
   <p>Every widget link for the workspace stops working.</p>
  </section>
  <section id="kept"><h2>What is kept</h2>
   <ul>
    <li>Your sign-in account (email and profile in Supabase Auth). See below.</li>
    <li>Copies you exported or downloaded, and emails already delivered.</li>
    <li>Data held by providers you connected yourself (for example your PayPal or Stripe account) and by AI providers under their own retention terms.</li>
    <li>Database backups, until they expire on the database provider&apos;s schedule.</li>
    <li>Server error records, which contain no workspace data (route, release and time only), for up to 14 days.</li>
   </ul>
  </section>
  <section id="visitors"><h2>Visitors</h2>
   <p>If you chatted with a business through its AutomatePal widget, that business controls your conversation. Ask it to delete the conversation; it can do so from Chat history. You can also write to us and we will pass the request on.</p>
  </section>
  <section id="account"><h2>Your sign-in account</h2>
   <p>To delete the sign-in account itself, email {LEGAL.contactEmail} from the account&apos;s address. Account deletion is handled by a person; delete your workspace data first so nothing is left behind. See the <Link href="/privacy#deletion">privacy policy</Link> for retention periods.</p>
  </section>
 </Doc>
</PublicShell>;}
