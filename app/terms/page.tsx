import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';

/* Wording of the original beta terms is kept sentence for sentence and grouped under headings. */
const TOC:[string,string][]=[['evaluation','Evaluation only'],['billing','Billing previews'],['use','Acceptable use'],['trademarks','Trademarks'],['related','Related documents']];

export default function Terms(){return <PublicShell>
 <DocHead kicker="Legal" title="Sandbox beta terms" updated="2026-10-31" lede="The boundaries for evaluating AutomatePal: fictional data only, no live payments and no production promise."/>
 <Doc toc={TOC}>
  <section id="evaluation"><h2>Evaluation only</h2>
   <p>This experimental project is provided for evaluation, without a promise of uptime, accuracy or production suitability. It does not move real money or provide financial advice. Use fictional data only.</p>
  </section>
  <section id="billing"><h2>Billing previews</h2>
   <p>Review every proposed billing action. Demo figures are simulations, not verified revenue. The beta is free; there is no paid service, refund promise or production payment mode.</p>
  </section>
  <section id="use"><h2>Acceptable use</h2>
   <p>Do not use the beta for fraud, illegal goods, credential collection or other activity prohibited by PayPal&apos;s Acceptable Use Policy. Third-party services have their own terms.</p>
  </section>
  <section id="trademarks"><h2>Trademarks</h2>
   <p>PayPal is a trademark of PayPal, Inc. AutomatePal is independent and not affiliated with or endorsed by PayPal.</p>
  </section>
  <section id="related"><h2>Related documents</h2>
   <p>How data is handled is in the <Link href="/privacy">privacy notice</Link>. Security controls and service providers are on the <Link href="/security">security page</Link>.</p>
  </section>
 </Doc>
</PublicShell>;}
