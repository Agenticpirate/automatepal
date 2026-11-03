import Link from 'next/link';
import PublicShell,{Doc,DocHead} from '../../components/PublicShell';
import {SUBPROCESSORS,LEGAL,LEGAL_UPDATED} from '../../../lib/legal';
import {legalMeta} from '../meta';
export const metadata=legalMeta('/legal/subprocessors','Subprocessors','The service providers that process data for AutomatePal, what each one does, where it runs and when it is used.');
const TOC:[string,string][]=[['list','Current subprocessors'],['billing','Billing providers'],['changes','Changes']];
export default function Subprocessors(){return <PublicShell>
 <DocHead kicker="Legal" title="Subprocessors" updated={LEGAL_UPDATED} lede="These providers process data so AutomatePal can work. Each has its own terms and privacy policy."/>
 <Doc toc={TOC}>
  <section id="list"><h2>Current subprocessors</h2>
   <div className="ps-scroll" role="region" aria-label="Subprocessor table" tabIndex={0}><table className="ps-table"><thead><tr><th scope="col">Provider</th><th scope="col">Purpose</th><th scope="col">Data</th><th scope="col">Location</th><th scope="col">Used</th></tr></thead>
    <tbody>{SUBPROCESSORS.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.purpose}</td><td>{p.data}</td><td>{p.location}</td><td>{p.when}</td></tr>)}</tbody></table></div>
  </section>
  <section id="billing"><h2>Billing providers</h2>
   <p>PayPal, Stripe and the other billing providers are not used by default. A provider receives data only after a workspace owner connects their own account, and then only for read-only lookups a verified visitor asks for. AutomatePal never executes payments, refunds or charges.</p>
  </section>
  <section id="changes"><h2>Changes</h2>
   <p>We update this page and its date before a new subprocessor starts processing customer data. Questions: {LEGAL.contactEmail}. See also the <Link href="/legal/dpa">data processing addendum</Link> and the <Link href="/privacy">privacy policy</Link>.</p>
  </section>
 </Doc>
</PublicShell>;}
