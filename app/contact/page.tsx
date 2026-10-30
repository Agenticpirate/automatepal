import Link from 'next/link';
export const metadata={title:'Contact and abuse reports - AutomatePal',description:'How to reach the AutomatePal beta owner for support, data deletion, security and abuse reports.'};
export default function Contact(){return <main className="mx-auto max-w-2xl p-8 space-y-5 text-gray-900"><Link href="/">← AutomatePal</Link><h1 className="text-3xl font-semibold">Contact and abuse reports</h1>
<p>AutomatePal is a one-person experimental beta. All contact is handled manually; there is no support team, guaranteed response time or service-level agreement.</p>
<section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-semibold">Reach the owner</h2>
<p>Email <a className="underline" href="mailto:raviteja.journal@gmail.com">raviteja.journal@gmail.com</a> for support questions, account or stored-activity deletion requests, and privacy concerns. Send deletion requests from the email address linked to your account so ownership can be checked. Deletion is handled manually; no completion time is promised.</p>
<p>The source code and public project notes are on <a className="underline" href="https://github.com/Agenticpirate/automatepal" rel="noreferrer" target="_blank">GitHub</a>.</p></section>
<section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-semibold">Report abuse or a security issue</h2>
<p>Email the same address with the subject line starting <span className="font-mono">[abuse]</span> or <span className="font-mono">[security]</span>. Include the page or demo-link URL, what you observed, and when. Do not include passwords, API keys, card numbers or other people&apos;s personal data in the report.</p>
<p>Abuse covers misuse of a demo widget or link, attempts to bypass quotas or isolation, and prohibited content in uploaded sources. Security reports cover suspected vulnerabilities. Reports are reviewed manually; a confirmation or fix timeline is not promised. Good-faith security research reported this way will not be treated as hostile.</p></section>
<section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-semibold">What not to send</h2>
<p>Never email or paste real customer details, payment credentials or sensitive business data. This beta works with fictional data only - see the <Link className="underline" href="/privacy">privacy notice</Link> and <Link className="underline" href="/terms">beta terms</Link>. Current service state is on the <Link className="underline" href="/status">status page</Link>.</p></section>
</main>}
