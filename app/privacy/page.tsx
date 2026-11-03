import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';
import {isProduction} from '../../lib/app-mode';
import {LEGAL,LEGAL_UPDATED} from '../../lib/legal';
/* Privacy policy. Production wording when APP_MODE=production; the preview adds the fictional-data warning.
   Unknown company details are [OWNER TO FILL] placeholders (lib/legal.ts). No certification is claimed. */
const TOC:[string,string][]=[['scope','Scope'],['who','Who we are'],['account','Sign-in and account data'],['workspace','Workspace and knowledge data'],['transcripts','Conversations and transcripts'],['ai','AI processing'],['email','Email'],['providers','Service providers'],['cookies','Cookies and browser storage'],['deletion','Retention and deletion'],['rights','Your choices and rights'],['payments','Payment information'],['contact','Contact and changes']];
export default function Privacy(){const prod=isProduction();return <PublicShell>
 <DocHead kicker="Legal" title={prod?'Privacy policy':'Beta privacy notice'} updated={LEGAL_UPDATED} lede={prod?'How AutomatePal handles sign-in, workspace content, visitor conversations, AI processing, email and deletion.':'How the fictional-data AutomatePal preview handles sign-in, workspace content, conversations, AI processing and deletion.'}/>
 <Doc toc={TOC}>
  <section id="scope"><h2>Scope</h2>
   {prod?<p>This policy covers the AutomatePal website and app at automatepal.onrender.com, and the support widget businesses embed on their own sites. When a business (our customer, the &quot;owner&quot;) uses AutomatePal to answer its visitors, the owner decides what is collected about those visitors; AutomatePal processes that data on the owner&apos;s behalf, as described in the <Link href="/legal/dpa">data processing addendum</Link>.</p>
   :<><p className="ps-note"><strong>AutomatePal is a development sandbox.</strong> Do not enter real customer details, payment credentials or sensitive business data.</p>
   <p>Use fictional data only. This beta is not intended for production use.</p></>}
  </section>
  <section id="who"><h2>Who we are</h2>
   <p>AutomatePal is operated by {LEGAL.entity}, {LEGAL.address}. Privacy questions: {LEGAL.contactEmail}.</p>
  </section>
  <section id="account"><h2>Sign-in and account data</h2>
   <p>If you use Google sign-in, your email, name and basic profile information are used for authentication through Supabase Auth. We do not request access to Gmail, Google Drive or your Google Calendar. Account email and login data are handled by Supabase Auth.</p>
  </section>
  <section id="workspace"><h2>Workspace and knowledge data</h2>
   <p>Widget settings, support requests and any contact address a visitor chose to give with consent are stored in your workspace. Knowledge source text and chunks are stored in Supabase. Scheduled website refreshes store the new text of changed pages until you apply or dismiss them. Access is limited to your workspace and the team members you invite, by role.</p>
   <p>Import-attempt history contains source IDs, status and timestamps, with at most 100 records retained per workspace. Exact custom responses are stored separately and can be removed separately.</p>
  </section>
  <section id="transcripts"><h2>Conversations and transcripts</h2>
   <p>AutomatePal stores full conversation transcripts: the questions visitors ask, the AI answers they were shown, messages between visitors and your team, and requests such as a handoff or a refund review. Transcripts also record where a question was asked (the website widget or the hosted help page) and, for analytics, how often the widget was opened and an AI-generated topic, sentiment and outcome label for each conversation.</p>
   <p>Transcripts are kept for the retention period the workspace owner chooses: 30, 90 (the default) or 365 days after a conversation&apos;s last activity. After that the conversation, its transcript and its ticket are deleted automatically by an hourly job. Owners and managers can delete a single conversation at any time from Chat history.</p>
  </section>
  <section id="ai"><h2>AI processing</h2>
   <p>Visitor questions and the matching published source passages are sent to Anthropic (Claude) to write and check answers, or to Google Gemini when Claude is not configured. Source text is sent to Google Gemini for embeddings only after the owner consents to processing. Short, contact-free excerpts of finished conversations are sent to the same model to label topics, within a daily spend cap.</p>
   <p>Published sources may be quoted to anyone using the owner&apos;s widget. Published exact responses are returned verbatim without a model call. AI providers&apos; own terms say how long they keep requests; free-tier Gemini content may be used by Google to improve its products{prod?'.':', which is one reason the preview accepts public or fictional content only.'}</p>
  </section>
  <section id="email"><h2>Email</h2>
   <p>When email is configured, AutomatePal sends email through Resend: alerts to the workspace owner when a visitor asks for a person, a refund review opens or a lead arrives; a weekly digest to the owner; team invites; and, only when a team member chooses to, their reply to a visitor who gave an email address with consent. Owner alerts never include visitor message text. The weekly digest, which goes only to the workspace owner, can list the most frequent unanswered questions. A visitor email contains only the team&apos;s reply.</p>
   <p>We keep a log of each email with its type, status, time, the provider&apos;s message id and a one-way hash of the recipient address, never the address or the text. Owners can turn alerts, lead emails and the digest off under Overview &gt; Email notifications.</p>
  </section>
  <section id="providers"><h2>Service providers</h2>
   <p>Supabase (sign-in and database), Cloudflare (hosting and network edge), Anthropic and Google (AI), Context.dev (optional page rendering during imports) and Resend (email) process data so AutomatePal can work. Billing providers such as PayPal or Stripe receive data only when an owner connects their own account. The full list, with what each provider does and where it runs, is on the <Link href="/legal/subprocessors">subprocessor list</Link>.</p>
  </section>
  <section id="cookies"><h2>Cookies and browser storage</h2>
   <p>AutomatePal does not set advertising or analytics cookies and loads no third-party trackers, so there is no cookie banner. Your browser keeps only what the app needs to work:</p>
   <ul>
    <li>your sign-in session, kept by Supabase Auth in local storage;</li>
    <li>guided-setup progress and which notifications you have read, in local storage;</li>
    <li>a Q&amp;A draft you hand from a resolved ticket to the Knowledge page, in session storage, which clears when the tab closes;</li>
    <li>whether the support widget is open, in session storage on the site where the widget is embedded.</li>
   </ul>
   <p>These are strictly necessary for the service you asked for. Signing out ends the session. Clearing this site&apos;s data in your browser removes the rest. If we ever add non-essential cookies, we will ask first and update this section.</p>
  </section>
  <section id="deletion"><h2>Retention and deletion</h2>
   <ul>
    <li>Conversations and transcripts: deleted automatically after the owner&apos;s retention period (30, 90 or 365 days), or earlier by the owner.</li>
    <li>Owner audit history: metadata only (resource, operation, ID, time), latest 1,000 events per workspace.</li>
    <li>Email log: metadata only, latest 1,000 per workspace. Operational logs: error codes and timings only, 7 to 14 days.</li>
    <li>Removing a knowledge source deletes its text, chunks and import history and stops future retrieval. It cannot recall answers already seen or exported.</li>
   </ul>
   <p>The workspace owner can export the workspace&apos;s data and delete it from the integrations page after typing a confirmation. What is deleted and what is kept, including the sign-in account, is explained on the <Link href="/legal/delete-account">account deletion page</Link>.</p>
  </section>
  <section id="rights"><h2>Your choices and rights</h2>
   <p>You can see, export and delete your workspace data yourself. If you are a visitor who used a business&apos;s widget, contact that business first: it controls your conversation and can delete it. You can also contact us at the address below. Depending on where you live, you may have rights to access, correct, delete or object to processing of your personal data, and to complain to a data protection authority.</p>
  </section>
  <section id="payments"><h2>Payment information</h2>
   <p>AutomatePal never takes payments and never executes refunds, captures or charges. Billing lookups are read-only. Never paste API keys, card numbers or passwords into chat.</p>
  </section>
  <section id="contact"><h2>Contact and changes</h2>
   <p>Questions about this policy: {LEGAL.contactEmail}. You can also use the <Link href="/contact">contact page</Link>. We will update the date at the top when this policy changes. See also the <Link href="/terms">terms</Link>, the <Link href="/legal/dpa">data processing addendum</Link> and the <Link href="/security">security page</Link>.</p>
  </section>
 </Doc>
</PublicShell>;}
