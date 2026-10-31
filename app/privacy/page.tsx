import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';
import {CONTACT_EMAIL} from '../../lib/site';

/* Wording of the original beta notice is kept sentence for sentence and grouped under headings.
   New on 2026-10-31: the browser storage section and the link to the service-provider list. */
const TOC:[string,string][]=[['scope','Scope'],['account','Sign-in and account data'],['workspace','Workspace and knowledge data'],['ai','AI processing'],['providers','Service providers'],['storage','Browser storage'],['deletion','Deletion and retention'],['payments','Payment information'],['contact','Contact']];

export default function Privacy(){return <PublicShell>
 <DocHead kicker="Legal" title="Beta privacy notice" updated="2026-10-31" lede="How the fictional-data AutomatePal preview handles sign-in, workspace content, AI processing and deletion."/>
 <Doc toc={TOC}>
  <section id="scope"><h2>Scope</h2>
   <p className="ps-note"><strong>AutomatePal is a development sandbox.</strong> Do not enter real customer details, payment credentials or sensitive business data.</p>
   <p>Use fictional data only. This beta is not intended for production use.</p>
  </section>
  <section id="account"><h2>Sign-in and account data</h2>
   <p>If you use Google sign-in, your email, name and basic profile information are used for authentication through Supabase Auth. We do not request access to Gmail, Google Drive or your Google Calendar. Account email and login data are handled by Supabase Auth.</p>
  </section>
  <section id="workspace"><h2>Workspace and knowledge data</h2>
   <p>Widget settings, fictional support requests and any explicitly consented demo contact address are stored in your workspace. Knowledge source text and chunks are stored in Supabase. Recorded sandbox activity, demo events and action proposals are stored in Supabase Postgres, and access is restricted to your account.</p>
   <p>Import-attempt history contains source IDs, status and timestamps, with at most 100 records retained per workspace; failed attempts without a saved source remain in this bounded history. Exact custom responses are stored separately and can be removed separately. Demo links expire after one hour; this does not automatically delete stored requests.</p>
  </section>
  <section id="ai"><h2>AI processing</h2>
   <p>Your chat requests may be sent to Google Gemini for response generation. Text is sent to Gemini for embeddings and source-based answers only after processing consent; published sources may be quoted to anyone holding your unexpired demo link.</p>
   <p>Free-tier Gemini content may be used by Google to improve its products. Upload public or fictional content only. Published exact responses are returned verbatim without a model check; other knowledge questions may be sent to Gemini.</p>
  </section>
  <section id="providers"><h2>Service providers</h2>
   <p>Account email and login data are handled by Supabase Auth. Sandbox API calls are sent to PayPal. Hosting is provided by Render.</p>
   <p>The full list, with what each provider does and where it runs, is on the <Link href="/security#subprocessors">security page</Link>.</p>
  </section>
  <section id="storage"><h2>Browser storage</h2>
   <p>AutomatePal does not use advertising or analytics cookies, and loads no third-party trackers. Your browser keeps only what the app needs to work:</p>
   <ul>
    <li>your sign-in session, kept by Supabase Auth in local storage;</li>
    <li>guided-setup progress and which notifications you have read, in local storage;</li>
    <li>a Q&amp;A draft you hand from a resolved ticket to the Knowledge page, in session storage, which clears when the tab closes;</li>
    <li>whether the support widget is open, in session storage on the site where the widget is embedded.</li>
   </ul>
   <p>Signing out ends the session. Clearing this site&apos;s data in your browser removes the rest.</p>
  </section>
  <section id="deletion"><h2>Deletion and retention</h2>
   <p>Removing a source deletes its stored text, chunks and source-linked import-attempt history and stops future retrieval. It cannot recall answers already seen or exported, stored question analytics or provider-held data.</p>
   <p>The integrations page has a confirmed preview-data deletion control and metadata-only owner audit history (up to 1000 events). This removes application data but not the sign-in account, provider-held data, exports or backups. Uncertain/executing actions block deletion. There is no automatic age-based purge.</p>
   <p>To request account or stored-activity deletion, contact <a href={'mailto:'+CONTACT_EMAIL}>{CONTACT_EMAIL}</a> from your account email. Deletion is handled manually; no completion time is promised. Do not use this beta if those limitations are unsuitable.</p>
  </section>
  <section id="payments"><h2>Payment information</h2>
   <p>No real payment information should be collected by AutomatePal. Never paste API keys, card numbers or PayPal passwords into chat.</p>
  </section>
  <section id="contact"><h2>Contact</h2>
   <p>Questions about this notice go to the address on the <Link href="/contact">contact page</Link>. See also the <Link href="/terms">beta terms</Link>.</p>
  </section>
 </Doc>
</PublicShell>;}
