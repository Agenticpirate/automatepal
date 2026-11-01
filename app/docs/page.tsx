import Link from 'next/link';
import type {Metadata} from 'next';
import PublicShell,{Doc,DocHead} from '../components/PublicShell';
import {SITE_URL} from '../../lib/site';
import {providerSummaries} from '../../lib/billing/core/registry';
import {BILLING_INTENTS,type BillingIntent} from '../../lib/billing/core/types';
import {MCP_TOOL_SUMMARY,TOOL_SCOPES,type McpToolName} from '../../lib/mcp/scopes';
import './docs.css';
/* Public docs. Server component: the provider list, capability matrix and MCP tool map are read from the
   code that enforces them (lib/billing/core/registry.ts, lib/mcp/scopes.ts), so this page cannot name a
   provider the registry does not enable. Prose limits mirror FEATURES.md and HARDENING.md.
   Not in app/sitemap.ts on purpose (verify-seo expects exactly seven public paths). */
const description='How to install the AutomatePal widget, control it from your page, connect a payment provider read-only, verify customers, reply in the widget, set working hours, manage leads and connect an MCP client. Includes what is not built yet.';
export const metadata:Metadata={title:'Docs',description,alternates:{canonical:'/docs'},robots:{index:true,follow:true},
 openGraph:{title:'Docs | AutomatePal',description,url:'/docs',images:[{url:'/opengraph-image',width:1200,height:630,alt:'AutomatePal fictional-data preview, no live payments'}]},
 twitter:{card:'summary_large_image',title:'Docs | AutomatePal',description,images:['/opengraph-image']}};
const TOC:[string,string][]=[['install','Install the widget'],['sdk','Widget SDK and events'],['followups','Follow-up suggestions'],['billing','Connect billing'],['verification','Customer verification'],['refunds','Refund reviews'],['replies','Owner replies'],['hours','Working hours'],['leads','Leads'],['mcp','MCP server'],['limits','Limits and what is not built']];
const INTENT_LABEL:Record<BillingIntent,string>={order_status:'Order or charge status',payment_history:'Payment history',failed_payment:'Failed payment and retry',invoice:'Invoice link',renewal:'Subscription renewal',refund_status:'Refund status'};
const CONFIDENCE:Record<string,string>={'official-spec':'Official API spec','official-spec-early-access':'Official spec, early access','docs-derived':'Built from API docs'};
// Least-privilege key guidance per provider. Mirrors each module's validateCredential (lib/billing/providers/*).
const KEY_NOTES:Record<string,string>={
 paypal:'REST app client ID and secret. Test uses your sandbox app (api-m.sandbox.paypal.com); live uses a live app (api-m.paypal.com).',
 stripe:'A restricted key with read permissions: rk_test_ for test, rk_live_ for live. A full sk_test_ key works with a warning. Full sk_live_ keys and publishable pk_ keys are refused.',
 dodo:'An API key from the matching environment (test.dodopayments.com or live.dodopayments.com). A key from the other mode fails the connection check.',
 razorpay:'Key ID and key secret: rzp_test_ for test, rzp_live_ for live.',
 paddle:'An API key with read permissions. Sandbox keys contain _sdbx and go to sandbox-api.paddle.com; live keys must not contain it.',
 square:'An access token with read scopes, from your sandbox or production application. Requests pin a Square-Version header.',
 adyen:'The API key of a Checkout webservice user plus your merchant account. Live also needs your live URL prefix.',
 mollie:'An API key: test_ for test, live_ for live. OAuth access_ tokens are refused.',
 chargebee:'A read-only API key and your site name. Choose test or live to match the site.',
 lemonsqueezy:'An API key. The connection check compares the store’s test mode with the mode you choose.',
};
const PROVIDER_NOTES:Record<string,string>={
 paypal:'Also checked read-only against a real sandbox account. Invoice lookups need the Invoicing feature on the sandbox app.',
 adyen:'Order status and payment links only. The Checkout API has no list endpoint for the other lookups.',
 mollie:'Stored as our own digest of the official spec, because the upstream spec has no license. No invoice links.',
 chargebee:'Invoice records come without a hosted link.',
};
const SCOPES:[string,string][]=[['mcp:read','All five read tools'],['support:read','Tickets and billing connection status (also the read-only API)'],['analytics:read','Owner overview counts (also the read-only API)'],['knowledge:write','Propose a text source, and list sources'],['bot:test','Ask the bot a test question'],['conversations:reply','Reply in a conversation you already took over, and list tickets'],['settings:read','Read the support settings'],['settings:write','Read and change the support settings']];
// Annotations as registered in lib/mcp/tools.ts (READ, PROPOSE, TEST).
const ANNOTATIONS:Record<McpToolName,string>={
 list_knowledge_sources:'readOnlyHint',get_unanswered_digest:'readOnlyHint',list_tickets:'readOnlyHint',get_owner_overview:'readOnlyHint',get_billing_connection_status:'readOnlyHint',
 add_text_knowledge_source:'not read-only, not destructive, closed world',ask_test_question:'not read-only, not destructive, open world (calls the model)',
 reply_to_conversation:'not read-only, not destructive, open world (the visitor sees it)',read_settings:'readOnlyHint',update_settings:'not read-only, destructive (overwrites the saved values), idempotent, closed world',
};
const MCP_CONFIG=JSON.stringify({mcpServers:{automatepal:{type:'http',url:SITE_URL+'/mcp',headers:{Authorization:'Bearer YOUR_TOKEN'}}}},null,2);
export default function Docs(){
 const providers=providerSummaries();
 const tools=Object.keys(TOOL_SCOPES) as McpToolName[];
 return <PublicShell>
  <DocHead kicker="Docs" title="Set up AutomatePal" lede={<>Everything here is built and covered by the repo’s checks. This is a fictional-data preview: payment execution stays off, and some features are built locally but not yet on the hosted preview. See <a href="#limits">Limits and what is not built</a>.</>} updated="2026-11-01"/>
  <Doc toc={TOC}>
   <section id="install" aria-labelledby="install-h">
    <h2 id="install-h">Install the widget</h2>
    <ol className="dc-steps">
     <li><b>Sign in</b> and open <Link href="/setup">guided setup</Link>.</li>
     <li><b>Add a source</b> in <Link href="/knowledge">Knowledge</Link>: paste text, upload Markdown, CSV or a small text PDF, import a public URL or crawl a site. Nothing answers customers until you consent to processing and publish it.</li>
     <li><b>Test</b> a few questions. Answers quote the passage they came from; when nothing supports an answer, the question goes to your review queue.</li>
     <li><b>Shape the widget</b> in <Link href="/support">Widget studio</Link>: colour, starter questions, side, allowed origins and paths, and working hours.</li>
     <li><b>Paste one script tag</b> before <code>&lt;/body&gt;</code>.</li>
    </ol>
    <pre className="dc-code" aria-label="Widget script tag"><code>{`<script src="${SITE_URL}/widget.js" data-demo-token="YOUR_TOKEN" defer></script>`}</code></pre>
    <p>In this preview the token comes from a one-hour demo link created in Widget studio. Origin and path rules control where the widget shows; they are not authentication for someone who holds the link.</p>
    <p>The chat refuses a message that carries its own system prompt, a pasted chat transcript or a request to ignore the bot’s instructions. The visitor sees “This message can’t be sent. Please rephrase your question.” and the text stays in the box. The server runs the same check before any model call, and the answer prompt tells the model never to show, translate or rewrite its instructions. Ordinary questions that mention instructions or a system go through. This is a filter, not a guarantee.</p>
   </section>
   <section id="sdk" aria-labelledby="sdk-h">
    <h2 id="sdk-h">Widget SDK and events</h2>
    <p>The script tag adds <code>window.AutomatePal</code> to your page. It exists as soon as the script runs; calls made before the widget is ready apply when it appears, and do nothing on a page where the widget is hidden.</p>
    <div className="ps-scroll"><table className="ps-table"><thead><tr><th>Call</th><th>What it does</th></tr></thead><tbody>
     <tr><td><code>AutomatePal.open()</code></td><td>Opens the chat panel (it loads on first open).</td></tr>
     <tr><td><code>AutomatePal.close()</code></td><td>Closes the panel.</td></tr>
     <tr><td><code>AutomatePal.toggle()</code></td><td>Opens or closes it.</td></tr>
     <tr><td><code>AutomatePal.reset()</code></td><td>Closes the panel, forgets its open state and starts a fresh panel on the next open. Questions already sent stay recorded for you, and the demo link is unchanged.</td></tr>
     <tr><td><code>AutomatePal.on(type, fn)</code></td><td>Calls <code>fn(payload)</code> for an event and returns a function that stops listening. <code>AutomatePal.off(type, fn)</code> does the same.</td></tr>
    </tbody></table></div>
    <div className="ps-scroll"><table className="ps-table"><thead><tr><th>Event</th><th>When</th><th>Payload</th></tr></thead><tbody>
     <tr><td><code>open</code></td><td>The panel opened</td><td><code>{'{type, trigger}'}</code>, trigger <code>api</code>, <code>button</code> or <code>auto</code></td></tr>
     <tr><td><code>close</code></td><td>The panel closed</td><td><code>{'{type, trigger}'}</code>, trigger <code>api</code>, <code>button</code> or <code>reset</code></td></tr>
     <tr><td><code>message_sent</code></td><td>The visitor sent a question, a request or a message to the team</td><td><code>{'{type, channel}'}</code>, channel <code>ai</code>, <code>request</code> or <code>person</code></td></tr>
     <tr><td><code>handoff_requested</code></td><td>The visitor asked for a person</td><td><code>{'{type, withinHours}'}</code></td></tr>
     <tr><td><code>lead_submitted</code></td><td>The visitor shared an email with consent</td><td><code>{'{type}'}</code></td></tr>
    </tbody></table></div>
    <p>Payloads never contain message text, names, email addresses, order details or the demo token. The same payloads are also dispatched on <code>window</code> as <code>automatepal:open</code>, <code>automatepal:message_sent</code> and so on. The panel posts events only to your page’s origin, and the script ignores messages from anywhere else.</p>
    <pre className="dc-code" aria-label="Widget SDK example"><code>{`window.addEventListener('automatepal:lead_submitted', () => {
  // count a lead in your own analytics; no email is included
});
document.querySelector('#help-link').onclick = () => AutomatePal.open();`}</code></pre>
   </section>
   <section id="followups" aria-labelledby="followups-h">
    <h2 id="followups-h">Follow-up suggestions</h2>
    <ul>
     <li>In Widget studio, add up to six follow-up questions, one per line, 3 to 80 characters each. Plain text only: angle brackets and control characters are refused.</li>
     <li>After an answer, the widget shows the first three as buttons, in your order, leaving out the question the visitor just asked. Clicking one asks it.</li>
     <li>The list is the same for every answer. It is not generated by a model.</li>
    </ul>
   </section>

   <section id="billing" aria-labelledby="billing-h">
    <h2 id="billing-h">Connect billing</h2>
    <p>Billing support answers order and charge status, payment history, failed payments and retries, invoices, renewal dates and refund status from your payment provider, where the provider supports the lookup. The capability matrix below shows which lookups each provider has. It is read-only: every provider request is matched against a fixed list of read endpoints (plus PayPal’s token sign-in) before it leaves the server, and anything else is refused. No money moves.</p>
    <h3>Server setup</h3>
    <div className="ps-scroll"><table className="ps-table"><thead><tr><th>Variable</th><th>What it holds</th></tr></thead><tbody>
     <tr><td><code>BILLING_ENCRYPTION_KEYS</code></td><td>Comma-separated <code>kid:base64</code> keys, 32 bytes each, for example <code>k1:$(openssl rand -base64 32)</code>.</td></tr>
     <tr><td><code>BILLING_ENCRYPTION_ACTIVE_KID</code></td><td>The key id new credentials are encrypted with, for example <code>k1</code>.</td></tr>
     <tr><td><code>BILLING_RPC_SECRET</code></td><td>A separate random secret (<code>openssl rand -hex 32</code>) that proves database calls come from the server. Rotating keys does not change it.</td></tr>
    </tbody></table></div>
    <p>Until these are set, <code>/billing</code> shows a setup banner and no credential can be saved. Credentials are encrypted with AES-256-GCM, bound to the workspace, provider and mode, never returned to the browser after saving and never logged.</p>
    <h3>Connect a provider</h3>
    <ol className="dc-steps">
     <li>Open <code>/billing</code> as the workspace owner or an admin and choose a provider.</li>
     <li>Choose <b>Test mode</b> or <b>LIVE</b>. LIVE can only be connected by the owner, who types <code>CONNECT LIVE &lt;PROVIDER&gt;</code>, for example <code>CONNECT LIVE STRIPE</code>. Every connection, card and lookup row is labelled Test mode or LIVE.</li>
     <li>Paste the credential. A read-only connection check runs before it is saved.</li>
     <li>Disconnect deletes the stored credential. The connection history keeps metadata only.</li>
    </ol>
    <h3>Key rotation</h3>
    <p>Add a new key, for example <code>k1:…,k2:…</code>, set <code>BILLING_ENCRYPTION_ACTIVE_KID=k2</code> and restart. Connections still on the old key show <b>Needs rotation</b> on <code>/billing</code>; <b>Rotate</b> re-encrypts them with the active key. Remove the old key once nothing needs rotation.</p>
    <h3>Providers</h3>
    <p>{providers.length} providers have a built adapter. Each is tested against the provider’s published API contract on a local mock server that checks every request it receives. The source label says what the contract came from.</p>
    <div className="dc-providers">{providers.map(p=><article key={p.id} className="dc-prov" aria-labelledby={'prov-'+p.id}>
     <header><h4 id={'prov-'+p.id}>{p.label}</h4><span className="dc-badge" data-conf={p.confidence}>{CONFIDENCE[p.confidence]??p.confidence}</span></header>
     <p><b>Credential:</b> {p.credentialFields.map(f=>f.label).join(' + ')}{p.configFields.length?<> · <b>Settings:</b> {p.configFields.map(f=>f.label).join(', ')}</>:null}</p>
     {KEY_NOTES[p.id]&&<p>{KEY_NOTES[p.id]}</p>}
     <p><b>Customers verify with:</b> {p.referenceHint}</p>
     {PROVIDER_NOTES[p.id]&&<p className="dc-muted">{PROVIDER_NOTES[p.id]}</p>}
    </article>)}</div>
    <h3>Capability matrix</h3>
    <p>The bot only offers a lookup the provider supports, and says so when it cannot.</p>
    <div className="ps-scroll"><table className="ps-table dc-matrix"><thead><tr><th>Provider</th>{BILLING_INTENTS.map(i=><th key={i}>{INTENT_LABEL[i]}</th>)}</tr></thead><tbody>
     {providers.map(p=><tr key={p.id}><td>{p.label}</td>{BILLING_INTENTS.map(i=><td key={i}>{p.capabilities[i]?<span className="ps-status ok">Yes</span>:<span className="ps-status no">No</span>}</td>)}</tr>)}
    </tbody></table></div>
    <p>Providers can be tried with test keys: <code>npm run billing:live-check -- &lt;provider&gt;</code> makes read-only calls with the keys named in <code>.env.example</code>.</p>
   </section>

   <section id="verification" aria-labelledby="verification-h">
    <h2 id="verification-h">Customer verification</h2>
    <ul>
     <li>Before any billing record is shown, the customer enters an order, invoice or payment ID and the email they paid with. Both must match the provider’s record.</li>
     <li>A match is valid for 30 minutes and never outlasts the chat link. Every later lookup stays inside that customer’s records, and each returned record is checked again before it is shown.</li>
     <li>“Not found” and “does not match” get the same reply, so the form cannot be used to test whether an order exists.</li>
     <li>The email is compared and discarded. It is never stored or logged, and the lookup log keeps metadata only: provider, mode, lookup type, outcome, a shortened record ID, status and amount.</li>
     <li>Limits: 5 failed verifications and 30 lookups per chat; per workspace 60 lookups per 10 minutes and 300 per UTC day; 30 per provider per 10 minutes.</li>
    </ul>
   </section>

   <section id="refunds" aria-labelledby="refunds-h">
    <h2 id="refunds-h">Refund reviews (never executed)</h2>
    <p>A verified customer can ask for a refund review on a payment. That opens the existing refund-review ticket with the payment attached. You record approve or decline in <Link href="/tickets">Tickets</Link>. Nothing executes: no refund, capture or charge call exists, and the provider is never written to.</p>
   </section>

   <section id="replies" aria-labelledby="replies-h">
    <h2 id="replies-h">Owner replies</h2>
    <ul>
     <li>Take over a conversation in Tickets. AI answers pause, including one already being prepared, and the header shows “Taken over · AI paused”.</li>
     <li>Use <b>Reply in widget</b> in the composer. The visitor sees the message in the widget within a few seconds while their page is open, and can answer in the same thread.</li>
     <li>Replies are shown in the widget only. Nothing is emailed.</li>
     <li>Up to 100 messages per conversation (50 from the visitor), 1,000 characters each. Replies stop when you release or close the conversation or its link expires.</li>
     <li>Ticket history records “Owner replied in the widget” without the text. Messages are deleted with the conversation and by preview-data deletion.</li>
    </ul>
   </section>

   <section id="hours" aria-labelledby="hours-h">
    <h2 id="hours-h">Working hours</h2>
    <ul>
     <li>In Widget studio, turn on working hours, pick a time zone and set one opening range per day. Overnight ranges are allowed.</li>
     <li>Write an away message of up to 300 characters.</li>
     <li>With “Let visitors choose AI or a person” on, the widget offers <b>Ask the AI</b> or <b>Talk to a person</b>.</li>
     <li>Outside your hours, a request for a person shows your away message and “Your request is saved for the team.” The visitor can still leave an email for a follow-up unless you hide contact.</li>
     <li>Working hours describe when you reply. They are not a staffing or response-time promise.</li>
    </ul>
   </section>

   <section id="leads" aria-labelledby="leads-h">
    <h2 id="leads-h">Leads</h2>
    <ul>
     <li>A lead is a contact email a visitor left in the widget with consent. The <Link href="/leads">Leads</Link> page lists the latest 500 for managers, admins and the owner. Agents cannot open it.</li>
     <li>Search matches the email or the request kind. Export downloads the leads shown as CSV, with cells that start with = + - @ escaped so spreadsheets treat them as text.</li>
     <li>Deleting a lead removes the address and the consent from that request. The request stays in Tickets. Deletions are audited.</li>
     <li>Leads are not forwarded to email or a CRM.</li>
    </ul>
   </section>
   <section id="mcp" aria-labelledby="mcp-h">
    <h2 id="mcp-h">MCP server</h2>
    <p>Endpoint <code>{SITE_URL}/mcp</code>, Streamable HTTP, stateless JSON responses, POST only. It serves one workspace, chosen by the token.</p>
    <h3>Tokens and scopes</h3>
    <p>Create a token on the Integrations page. Tokens are hashed at rest, expire after 1 to 168 hours, can be revoked, and at most five are active per workspace. Send it as <code>Authorization: Bearer ap_ro_…</code>. Each token has one scope, and only that scope’s tools are listed.</p>
    <div className="ps-scroll"><table className="ps-table"><thead><tr><th>Scope</th><th>Tools</th></tr></thead><tbody>{SCOPES.map(([s,d])=><tr key={s}><td><code>{s}</code></td><td>{d}</td></tr>)}</tbody></table></div>
    <h3>Tools</h3>
    <div className="ps-scroll"><table className="ps-table"><thead><tr><th>Tool</th><th>What it returns</th><th>Scopes</th><th>Annotations</th></tr></thead><tbody>
     {tools.map(t=><tr key={t}><td><code>{t}</code></td><td>{MCP_TOOL_SUMMARY[t]}</td><td>{TOOL_SCOPES[t].join(', ')}</td><td>{ANNOTATIONS[t]}</td></tr>)}
    </tbody></table></div>
    <p>Read tools return metadata and counts, except <code>get_unanswered_digest</code>, which includes the text of visitor questions it could not answer. No tool returns owner or visitor message bodies, contact addresses, credentials or source text. <code>reply_to_conversation</code> is the only tool a visitor sees: it posts a team reply in the widget, only in a conversation you already took over in Tickets, and it never takes one over. <code>update_settings</code> changes only the chat mode (working hours on or off), working hours, away message, the AI-or-person choice and the contact field. There are no code-execution, takeover, email or payment tools.</p>
    <h3>Example client config</h3>
    <pre className="dc-code" aria-label="Example MCP client configuration"><code>{MCP_CONFIG}</code></pre>
    <h3>Limits</h3>
    <ul>
     <li>30 requests per minute per token, 64 KB per request, one JSON-RPC message per request (batches are refused).</li>
     <li>Requests from a foreign browser Origin get 403. Missing or invalid tokens get 401.</li>
     <li>Proposals: 10 per workspace per UTC day, 30 sources in total. A proposal stays unpublished until a manager approves it in Knowledge and then publishes it with consent.</li>
     <li>Test questions: 20 per UTC day, not recorded in analytics. Source answers need the knowledge search provider configured.</li>
     <li>Replies: only while the conversation is taken over and its link has not expired, 1,000 characters each, 100 messages per conversation. The ticket history records that a reply was sent via an MCP token, not the text. Nothing is emailed.</li>
     <li>Settings changes: 20 per workspace per UTC day, validated like Widget studio (turning working hours on needs a time zone), audited.</li>
     <li>One metadata row per tool call (tool and outcome, never arguments).</li>
    </ul>
   </section>

   <section id="limits" aria-labelledby="limits-h">
    <h2 id="limits-h">Limits and what is not built</h2>
    <ul>
     <li>Billing support, owner replies, working hours and the MCP server are built and tested locally. Their database migrations (044 to 047) are not yet applied to the hosted preview. The same goes for leads, the MCP reply and settings tools, the widget SDK and follow-up suggestions.</li>
     <li>Only PayPal has been checked against a real sandbox account. The other providers are verified against their published contracts and local mocks, not real accounts.</li>
     <li>Polar, Braintree and Cashfree adapters are not built, and no other provider is supported.</li>
     <li>Payment execution is off everywhere. The bot cannot charge, capture or refund, and refund decisions are records only.</li>
     <li>No email, Slack, WhatsApp or SMS delivery. Owner replies reach the visitor only inside the widget.</li>
     <li>No external MCP client (for example a desktop assistant or an IDE) has been acceptance-tested yet.</li>
     <li>No SOC 2, HIPAA or uptime SLA. See <Link href="/security">Security</Link> and <Link href="/status">Status</Link>.</li>
    </ul>
   </section>
  </Doc>
 </PublicShell>;
}
