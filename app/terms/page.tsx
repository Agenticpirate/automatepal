import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';
import {isProduction} from '../../lib/app-mode';
import {LEGAL,LEGAL_UPDATED} from '../../lib/legal';
/* Terms of service. Production wording when APP_MODE=production; the preview keeps the evaluation-only rules.
   Unknown company details are [OWNER TO FILL] placeholders (lib/legal.ts). */
const TOC:[string,string][]=[['service','The service'],['accounts','Accounts and teams'],['data','Your content and your visitors'],['ai','AI answers'],['billing','Billing support'],['use','Acceptable use'],['availability','Availability and changes'],['liability','Disclaimers and liability'],['ending','Ending the service'],['law','Governing law'],['trademarks','Trademarks'],['related','Related documents']];
export default function Terms(){const prod=isProduction();return <PublicShell>
 <DocHead kicker="Legal" title={prod?'Terms of service':'Sandbox beta terms'} updated={LEGAL_UPDATED} lede={prod?'The agreement between you and the operator of AutomatePal for using the app and the support widget.':'The boundaries for evaluating AutomatePal: fictional data only, no live payments and no production promise.'}/>
 <Doc toc={TOC}>
  <section id="service"><h2>The service</h2>
   {prod?<p>AutomatePal is operated by {LEGAL.entity} (&quot;we&quot;). It lets a business answer its website visitors from the business&apos;s own published sources, hand conversations to a person, and look up billing records read-only. By creating a workspace you agree to these terms on behalf of yourself or the business you represent.</p>
   :<p>This experimental project is provided for evaluation, without a promise of uptime, accuracy or production suitability. It does not move real money or provide financial advice. Use fictional data only.</p>}
  </section>
  <section id="accounts"><h2>Accounts and teams</h2>
   <p>The person who creates a workspace is its owner and is responsible for the team members they invite and the roles they give. Keep sign-in access and API tokens private. Tell us promptly about any unauthorised use.</p>
  </section>
  <section id="data"><h2>Your content and your visitors</h2>
   <p>You keep ownership of the content you upload and of your visitors&apos; conversations. You give us permission to store and process it only to run the service for you, as described in the <Link href="/privacy">privacy policy</Link> and the <Link href="/legal/dpa">data processing addendum</Link>. You are responsible for having the right to upload your content, for telling your visitors how their data is used, and for the retention period you choose.</p>
  </section>
  <section id="ai"><h2>AI answers</h2>
   <p>Answers are generated from the sources you publish and can still be wrong or incomplete. Questions the sources do not support are sent to a person. You remain responsible for what your published sources say and for decisions made from AI answers or AI labels.</p>
  </section>
  <section id="billing"><h2>Billing support</h2>
   <p>Billing provider connections are read-only. AutomatePal never takes a payment and never executes a refund, capture, cancellation or charge; refund requests are recorded for a person to review in your own provider account. {prod?'The service is currently free; if paid plans are introduced, the price will be shown and agreed before any charge.':'Demo figures are simulations, not verified revenue. The beta is free; there is no paid service, refund promise or production payment mode.'}</p>
  </section>
  <section id="use"><h2>Acceptable use</h2>
   <p>Do not use AutomatePal for fraud, illegal goods, credential collection, spam, harassment, or to store health, card or other sensitive data it is not designed for. Do not probe or overload the service except through a coordinated security report (see the <Link href="/security#report">security page</Link>). Payment providers&apos; own acceptable use policies also apply to your connected accounts.</p>
  </section>
  <section id="availability"><h2>Availability and changes</h2>
   <p>We work to keep AutomatePal available but do not promise an uptime level or a service level agreement. Features can change; we will give reasonable notice of changes that remove something you rely on. Current service state is on the <Link href="/status">status page</Link>.</p>
  </section>
  <section id="liability"><h2>Disclaimers and liability</h2>
   <p>The service is provided &quot;as is&quot; to the extent the law allows. We are not liable for indirect or consequential losses, or for losses caused by your published sources, your settings or your providers. Nothing in these terms limits liability that cannot be limited by law. AutomatePal holds no SOC 2, ISO 27001, HIPAA or other certification.</p>
  </section>
  <section id="ending"><h2>Ending the service</h2>
   <p>You can stop at any time: export your data, then delete it as described on the <Link href="/legal/delete-account">account deletion page</Link>. We may suspend a workspace that breaks these terms or puts others at risk, and will tell the owner why unless the law prevents it.</p>
  </section>
  <section id="law"><h2>Governing law</h2>
   <p>These terms are governed by {LEGAL.governingLaw}. Contact: {LEGAL.contactEmail}, {LEGAL.address}.</p>
  </section>
  <section id="trademarks"><h2>Trademarks</h2>
   <p>PayPal, Stripe and the other provider names are trademarks of their owners. AutomatePal is independent and not affiliated with or endorsed by them.</p>
  </section>
  <section id="related"><h2>Related documents</h2>
   <p><Link href="/privacy">Privacy policy</Link> · <Link href="/legal/dpa">Data processing addendum</Link> · <Link href="/legal/subprocessors">Subprocessors</Link> · <Link href="/legal/delete-account">Deleting your account</Link> · <Link href="/security">Security</Link></p>
  </section>
 </Doc>
</PublicShell>;}
