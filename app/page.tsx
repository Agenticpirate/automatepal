'use client';
import {modeText} from '../lib/app-mode';
import Link from 'next/link';import Image from 'next/image';import {useEffect,useState} from 'react';import DeskShell from './components/DeskShell';
import AnswerPipeline from './components/home/AnswerPipeline';
import BotDemo from './components/home/BotDemo';
import AddOns from './components/home/AddOns';
import FolderWordmark from './components/home/FolderWordmark';
import {PlatformGlyph,CheckMark,ClockMark,VerifiedMark,type PlatformIcon} from './components/home/PlatformIcons';
import {ProfileMark} from './components/home/BotMark';
import {PROVIDER_LABELS,providerSentence,capabilityExceptions} from './components/home/billing-providers';
import {SITE_URL,CONTACT_EMAIL,REPO_URL,COPYRIGHT_HOLDER} from '../lib/site';
import './preview/video/video.css';
import './home.css';

/* Lucide icons (ISC license, lucide.dev) - inline SVG, no dependency */
const PATHS: Record<string, React.ReactNode> = {
  home: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>),
  grid: (<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>),
  tag: (<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>),
  mail: (<><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></>),
  login: (<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></>),
  quote: (<><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></>),
  shieldcheck: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></>),
  usercheck: (<><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="m16 19 2 2 4-4"/></>),
  listchecks: (<><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></>),
  clock: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  arrowupright: (<><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>),
  arrowright: (<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>),
  sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l-1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></>),
  ban: (<><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>),
  inbox: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>),
  sliders: (<><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></>),
  filetext: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></>),
  appwindow: (<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/></>),
  barchart: (<><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></>),
  code: (<><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>),
  database: (<><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></>),
  key: (<><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>),
  send: (<><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>),
  history: (<><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></>),
  gauge: (<><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></>),
  check: (<><path d="M20 6 9 17l-5-5"/></>),
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>),
  creditcard: (<><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></>),
};
function Icon({ name, size = 16, strokeWidth = 2 }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>);
}
const VP_NAV: { label: string; href: string; icon: keyof typeof PATHS; active?: boolean }[] = [
  { label: 'Home', href: '/', icon: 'home', active: true },
  { label: 'Product', href: '#features', icon: 'sparkles' },
  { label: 'Add-ons', href: '#addons', icon: 'grid' },
  { label: 'Pricing', href: '/pricing', icon: 'tag' },
];
/* Capability strip: every item is a shipped preview feature (see FEATURES.md). */
type Feature = { icon: PlatformIcon; title: string; body: string; wide?: boolean; visual: React.ReactNode };
const FEATURES: Feature[] = [
  { icon: 'quote', wide: true, title: 'Answers your customers can check', body: 'Every reply comes with the exact passage it was built from, so customers and your team can see where it came from. A separate grounding check has to agree before anything is sent.',
    visual: <div className="hm-v-chat"><p className="hm-v-ask">How many seats are in the student plan?</p><p className="hm-v-reply">The student plan includes 25 seats.</p><blockquote className="hm-v-quote"><p>“…the North Dock student plan includes <mark>25 seats</mark>.”</p><span><VerifiedMark/>Student plan exception · grounding passed</span></blockquote></div> },
  { icon: 'inbox', title: 'One queue for what it can’t answer', body: 'Incidents, requests and open questions land in one place, ranked by impact and urgency, with guarded status changes and private notes.',
    visual: <ul className="hm-v-rows"><li><b>Incident</b>Checkout error<em data-tone="hot">High · urgent</em></li><li><b>Request</b>Refund review<em>Owner decision</em></li><li><b>Question</b>Student plan seats<em data-tone="ok">Answered</em></li></ul> },
  { icon: 'sliders', title: 'Teach it your exceptions', body: 'Add exceptions with start and end dates, or exact answers for the questions you never want reworded.',
    visual: <div className="hm-v-chips"><span><b>Exception</b>Nov 1 – Dec 31 · 25 seats</span><span><b>Exact answer</b>“What are your hours?”</span></div> },
  { icon: 'filetext', title: 'Start with the docs you have', body: 'Paste text, upload Markdown or a PDF, or import a public URL. Nothing reaches a customer until you consent and publish.',
    visual: <ul className="hm-v-files"><li><CheckMark/>pricing.pdf<em>Published</em></li><li><CheckMark/>faq.md<em>Published</em></li><li data-pending="true"><ClockMark/>help.example.com/returns<em>In review</em></li></ul> },
  { icon: 'appwindow', title: 'Looks like your brand', body: 'Pick the colors, starter questions and placement, and choose which sites and pages show the widget. Optional lead capture asks for consent first.',
    visual: <div className="hm-v-widget" aria-hidden="true"><span className="hm-v-swatches"><i/><i/><i/></span><span className="hm-v-greet">Hi! Ask me anything.</span><span className="hm-v-launcher"><Icon name="sparkles" size={14}/></span></div> },
  { icon: 'card', wide: true, title: 'Billing answers from your payment provider', body: `Order and charge status, payment history, failed payments and retries, invoices, renewal dates and refund status from ${providerSentence()}, where the provider supports the lookup. ${capabilityExceptions()} The customer verifies an order or invoice number and the email they paid with first, and only sees their own records. Read-only in test or live mode; refunds go to your review and nothing executes.`,
    visual: <div className="hm-v-bill"><div className="hm-v-bill-card"><div className="hm-v-bill-head"><b>PayPal · Test mode</b><span><VerifiedMark/>Verified for this chat</span></div><p><span>Invoice ND-48213</span><b>Paid · USD 49.00</b></p><p><span>Refund request</span><b data-tone="review">Owner review · nothing executes</b></p></div><ul className="hm-v-provs" aria-label="Payment providers with a built, tested adapter">{PROVIDER_LABELS.map(p=><li key={p}>{p}</li>)}</ul></div> },
  { icon: 'reply', title: 'Reply inside the widget', body: 'Take over a conversation and reply from Tickets. The visitor sees your message live in the widget and can answer back. A reply is emailed only if you choose to and the visitor left an address with consent. Messages are deleted with the conversation.',
    visual: <div className="hm-v-thread" aria-hidden="true"><span className="hm-v-paused">Taken over · AI paused</span><p className="hm-v-owner"><ProfileMark size={22} tone="owner"/><span>Hi, it’s Sam. Your order ships tomorrow.</span></p><p className="hm-v-visitor"><span>Perfect, thank you!</span></p><em>Shown in the widget</em></div> },
  { icon: 'clock', title: 'Working hours and away message', body: 'Set your time zone and opening hours. Visitors choose the AI or a person; outside your hours they see your away message and their request is saved for the team.',
    visual: <div className="hm-v-hours" aria-hidden="true"><div className="hm-v-week">{['M','T','W','T','F','S','S'].map((d,i)=><span key={i} data-off={i>4||undefined}>{d}</span>)}</div><p className="hm-v-away">We’re away right now. Your request is saved for the team.</p><div className="hm-v-choice"><span>Ask the AI</span><span>Talk to a person</span></div></div> },
  { icon: 'plug', wide: true, title: 'Connect AI assistants over MCP', body: 'Point an MCP client at /mcp with a scoped, expiring AutomatePal token. Five read tools cover knowledge sources, unanswered questions, tickets, overview counts and billing status. Opt-in tools, each with its own scope, propose a text source that stays unpublished until you approve it, ask the bot a test question, reply in a conversation you already took over, or change working hours and the away message. No code execution, no takeover and no email.',
    visual: <pre className="hm-v-code hm-v-mcp" aria-label="Example MCP tool calls"><span className="hm-v-ln"><span>POST</span> /mcp  <i>Streamable HTTP</i> <i>Bearer ap_ro_••••</i></span><span className="hm-v-ln"><span>list_tickets</span>               <i>readOnlyHint</i></span><span className="hm-v-ln"><span>add_text_knowledge_source</span>  <i>stays unpublished</i></span></pre> },
];
const TRUST: { icon: keyof typeof PATHS; title: string; body: string }[] = [
  { icon: 'database', title: 'Tenant isolation', body: 'Postgres row-level security separates every workspace. Tests deny cross-tenant reads, forged writes and foreign RPC calls.' },
  { icon: 'gauge', title: 'Abuse budgets', body: 'Per-conversation and daily answer budgets are enforced before any model call, and refusals count.' },
  { icon: 'shieldcheck', title: 'Consent and deletion', body: 'Knowledge needs explicit processing and publishing consent. Owners can delete their workspace data themselves.' },
  { icon: 'lock', title: 'Encrypted, rotatable provider keys', body: 'Payment provider credentials are encrypted with AES-256-GCM under a server keyring you can rotate. They are never sent back to the browser or written to logs.' },
  { icon: 'ban', title: 'Read-only by design: write calls are blocked in code', body: 'Every provider request is checked against a fixed list of read endpoints, plus PayPal’s token sign-in, before it leaves the server. Anything else is refused, and tests confirm no request is sent.' },
  { icon: 'creditcard', title: 'No money movement', body: 'The bot cannot charge, capture or refund. Refund requests become review items; you record approve or decline, and nothing executes.' },
];
const FAQ:[string,string][]=[
  ['How is this different from a regular AI chatbot?','A regular chatbot answers whether or not your content backs it up. AutomatePal attaches the exact passage it used, and a separate check has to agree before the reply is sent. When nothing in your sources supports an answer, the question goes to your review queue instead of becoming a guess.'],
  ['What happens when it doesn’t know the answer?','Nothing is sent to the customer. The question becomes a review item with the conversation attached, and it shows up in your unanswered list so you only have to add the missing answer once.'],
  ['Can it handle billing questions?',`Yes. Once you connect a payment provider, it answers order and charge status, payment history, failed payments and retries, invoices, renewal dates and refund status, where the provider supports the lookup. ${capabilityExceptions()} Each answer shows the billing record it came from. Refunds always go to a person for a decision; the bot never moves money. Billing support is in preview.`],
  ['Which payment providers does it work with?',`${providerSentence()}, each in test or live mode. Every adapter is tested against the provider’s published API contract on a local mock server. Razorpay and Lemon Squeezy are built from their API docs rather than a published spec, and Chargebee’s spec is labelled early access. ${capabilityExceptions()} So far only PayPal has also been checked against a real sandbox account.`],
  ['Can it issue refunds?','No. The bot never charges, captures or refunds, and no write call to a provider is allowed. A refund request opens a review ticket with the payment attached. You record approve or decline, and nothing executes.'],
  ['How are customers verified before billing answers?','The customer enters an order, invoice or payment ID and the email they paid with, and both must match the provider’s record. Verification lasts 30 minutes for that chat, every lookup stays inside that customer’s records, and the email is never stored.'],
  ['Are owner replies emailed?','Only if you choose to. After you take over a conversation, your replies appear live in the widget and the visitor can answer there. If the visitor left an email address with consent, you can also email your reply text to them; nothing else from the conversation is sent. Outside your working hours, visitors see your away message and can leave an email for a follow-up if you allow it.'],
  ['What does the MCP server expose?','One endpoint, /mcp, over Streamable HTTP, authorized with a scoped, expiring AutomatePal token. Read tools cover knowledge sources, unanswered questions, tickets, overview counts and billing connection status. They return metadata and counts, except the unanswered-questions digest, which includes the visitors’ question text. Write tools each need their own scope: one proposes a text source, which stays unpublished until you approve and publish it; one asks the bot a test question; one replies in the widget, only in a conversation you already took over in Tickets; and one changes the chat mode, working hours, away message, AI-or-person choice and contact field. There are no code-execution, takeover or email tools.'],
  ['Can my whole team use it?','Yes. Invite admins, managers and agents with private links. Each role has its own permissions, enforced in the database, and every change is recorded with who made it.'],
  ['Do I need a developer?','No. Sources, testing and the widget’s look are all set up in the dashboard. Going live means pasting one script tag into your site, the same way you would add an analytics snippet.'],
  ['Is my data safe?','Each workspace is isolated at the database level, API tokens are scoped and expire, and you can delete your workspace data yourself. AutomatePal does not yet hold SOC 2 or HIPAA certification.'],
];
/* Cursor spotlight on feature cards: mouse only, sets the card's own variables. */
function spot(e: React.PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}
/* 07 - Owner's view: the redesigned conversation inbox (Tickets) and the owner overview, both rendered from
   the real app with fictional demo data. Tabs follow the ARIA tabs pattern (arrow keys move between them). */
type OwnerTab='inbox'|'overview';
const OWNER_TABS:{id:OwnerTab;label:string;url:string}[]=[{id:'inbox',label:'Conversation inbox',url:'tickets'},{id:'overview',label:'Owner overview',url:'owner overview'}];
const OWNER_NOTES=['AI assistant, owner and visitor in one thread','“Taken over · AI paused” stays visible','Replies show in the widget. Email only with visitor consent.'];
function OwnerView(){
  const[tab,setTab]=useState<OwnerTab>('inbox');
  const onKey=(e:React.KeyboardEvent)=>{if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;e.preventDefault();const next:OwnerTab=tab==='inbox'?'overview':'inbox';setTab(next);document.getElementById('ov-tab-'+next)?.focus();};
  const cur=OWNER_TABS.find(t=>t.id===tab)!;
  return <section className="ap-product hm-ov" aria-labelledby="owner-view-title">
    <div className="ap-product-head"><div><p className="hm-kicker">04 / The owner’s view</p><h2 id="owner-view-title" className="hm-h2">See what needs you.<br/>Skip the rest.</h2></div><p>Every conversation in one inbox, with the AI assistant, you and the visitor in one thread. Take over, reply inside the widget and hand back when you’re done. The overview keeps the counts and trends.</p></div>
    <div className="hm-ov-tabs" role="tablist" aria-label="Owner screens" onKeyDown={onKey}>{OWNER_TABS.map(t=><button key={t.id} id={'ov-tab-'+t.id} type="button" role="tab" aria-selected={tab===t.id} aria-controls={'ov-panel-'+t.id} tabIndex={tab===t.id?0:-1} onClick={()=>setTab(t.id)}>{t.label}</button>)}</div>
    <div className="hm-clip ap-rv"><div className="ap-product-frame" data-demo="product-screenshots">
      <div className="ap-product-bar"><span className="ap-chrome-dots" aria-hidden="true"><i/><i/><i/></span><span className="ap-chrome-url">AutomatePal / {cur.url}</span><span className="ap-chrome-tag">Rendered product · fictional test data</span></div>
      <div id="ov-panel-inbox" role="tabpanel" aria-labelledby="ov-tab-inbox" hidden={tab!=='inbox'} className="ap-product-crop hm-ov-panel hm-ov-inbox">
        <Image className="hm-ov-wide" src="/product-inbox.png" alt="Actual AutomatePal conversation inbox rendered with fictional test data: the conversation list with avatars and previews, a taken-over conversation whose header names the AI assistant, the owner and the visitor with AI paused, and the reply-in-widget composer." width={1440} height={900}/>
        <Image className="hm-ov-narrow" src="/product-inbox-mobile.png" alt="Actual AutomatePal conversation inbox on a phone, rendered with fictional test data, showing a taken-over conversation with AI paused and the reply-in-widget composer." width={390} height={844}/>
      </div>
      <div id="ov-panel-overview" role="tabpanel" aria-labelledby="ov-tab-overview" hidden={tab!=='overview'} className="ap-product-crop hm-ov-panel"><Image src="/product-owner.png" alt="Actual AutomatePal owner overview rendered with fictional test data, including intervention counts, trends and the needs-intervention list." width={1280} height={2183}/></div>
    </div></div>
    <ul className="hm-ov-notes">{OWNER_NOTES.map(n=><li key={n}><Icon name="check" size={13} strokeWidth={3}/>{n}</li>)}</ul>
    <div className="hm-ov-links"><Link href="/tickets" className="ap-text-link">Open the inbox ↗</Link><Link href="/owner" className="ap-text-link">Open the owner overview ↗</Link></div>
  </section>;
}
export default function Landing(){
  const[open,setOpen]=useState(false);
  useEffect(()=>{const els=Array.from(document.querySelectorAll('.ap-rv'));els.forEach(el=>el.classList.add('ap-rv-off'));const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('ap-rv-in');io.unobserve(e.target);}}),{threshold:.18});els.forEach(el=>io.observe(el));return()=>io.disconnect();},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};const onResize=()=>{if(window.innerWidth>720)setOpen(false);};window.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);};},[]);
  const stagger=(i:number)=>({'--i':i} as React.CSSProperties);
  return <DeskShell widget><main id="main-content" className="ap-public ap-home"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"WebSite",name:"AutomatePal",url:SITE_URL+"/",description:"AI customer support that shows its work: an AI support agent for your website that quotes its sources and hands the rest to your team. "+modeText('Fictional-data preview, no live payments.','Free to start.'),inLanguage:"en",publisher:{"@type":"Organization",name:"AutomatePal",url:SITE_URL+"/",logo:SITE_URL+"/icon-512.png",sameAs:[REPO_URL],contactPoint:{"@type":"ContactPoint",contactType:"customer support",email:CONTACT_EMAIL,availableLanguage:"en"}}}).replace(/</g,"\\u003c")}}/>
  <script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify([{"@context":"https://schema.org","@type":"SoftwareApplication",name:"AutomatePal",applicationCategory:"BusinessApplication",applicationSubCategory:"Customer support software",operatingSystem:"Web",url:SITE_URL+"/",description:"AI customer support chatbot trained on your website and help docs. Every answer quotes its source, and your team takes over refunds and edge cases.",offers:{"@type":"Offer",price:"0",priceCurrency:"USD",description:"Free plan"}},{"@context":"https://schema.org","@type":"FAQPage",mainEntity:FAQ.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))}]).replace(/</g,"\\u003c")}}/>
  <section className="vp vp-static" aria-label="Intro">
    <div className="vp-bg" aria-hidden="true"/><div className="vp-bg-tint" aria-hidden="true"/>
    <div className="vp-page">
      <header className={open?'vp-header vp-open':'vp-header'}>
        <Link href="/" className="vp-logo" aria-label="AutomatePal home"><Image src="/automatepal-logo.png" alt="" width={104} height={51} priority/></Link>
        <nav className="vp-nav" aria-label="Primary">{VP_NAV.map(n=>(<Link key={n.label} href={n.href} className={n.active?'vp-active':undefined} aria-current={n.active?'page':undefined}><Icon name={n.icon} size={14}/>{n.label}</Link>))}</nav>
        <Link href="/login" className="vp-signin"><Icon name="login" size={14}/>Sign in</Link>
        <button className="vp-burger" aria-label="Menu" aria-expanded={open} onClick={()=>setOpen(!open)}><i/><i/><i/></button>
      </header>
      {open&&(<><div className="vp-overlay" onClick={()=>setOpen(false)}/><nav className="vp-sheet" aria-label="Mobile">{VP_NAV.map((n,i)=>(<Link key={n.label} href={n.href} className={n.active?'vp-active':undefined} aria-current={n.active?'page':undefined} style={{animationDelay:`${0.05+i*0.05}s`}} onClick={()=>setOpen(false)}><Icon name={n.icon} size={15}/>{n.label}</Link>))}<Link href="/login" className="vp-sheet-signin" style={{animationDelay:'0.25s'}} onClick={()=>setOpen(false)}><Icon name="login" size={15}/>Sign in</Link></nav></>)}
      <div className="vp-hero hx">
        <p className="hx-eyebrow vp-anim" style={{'--d':'0.05s'} as React.CSSProperties}><span className="hx-dot" aria-hidden="true"/>AI customer support for websites and online stores</p>
        <h1 className="hx-h1"><span className="hx-line"><span>AI support that</span></span><span className="hx-line"><span><em>shows its work.</em></span></span></h1>
        <p className="vp-sub hx-sub vp-anim" style={{'--d':'0.34s'} as React.CSSProperties}>AutomatePal turns your website and help docs into a support agent that answers customers in seconds, quotes the exact source, and hands refunds and edge cases to your team.</p>
        <div className="hm-hero-ctas vp-anim" style={{'--d':'0.44s'} as React.CSSProperties}>
          <Link href="/setup" className="vp-cta" style={{animationName:'vp-revealPulse'} as React.CSSProperties}>Start free <span className="vp-cta-arrow"><Icon name="arrowupright" size={14} strokeWidth={2.4}/></span></Link>
          <a href="#demo" className="hm-cta-ghost">Watch it answer <Icon name="arrowright" size={14}/></a>
        </div>
        <p className="hm-hero-note vp-anim" style={{'--d':'0.5s'} as React.CSSProperties}>Free to start. No credit card. Live with one line of code.</p>
      </div>
      {/* A scripted example, not a live chat: one question answered with its quoted source, drawn in on load. */}
      <div className="hx-stage vp-anim" style={{'--d':'0.6s'} as React.CSSProperties} role="img" aria-label="Example: a shopper asks whether an item can be returned after 30 days. The agent answers yes, within 45 days of delivery, and shows the line of the returns policy it quoted.">
        <div className="hx-float hx-float-l" aria-hidden="true"><span className="hx-float-ic"><Icon name="usercheck" size={15}/></span><span><b>Handed to your team</b><small>Refund review, context attached</small></span></div>
        <div className="hx-card" aria-hidden="true">
          <div className="hx-card-head"><span className="hx-url"><i/>yourstore.com</span><span className="hx-time"><Icon name="clock" size={12}/>Answered in 2.8s</span></div>
          <p className="hx-q">Can I return an item after 30 days?</p>
          <div className="hx-a"><span className="hx-typing"><i/><i/><i/></span><p>Yes. Unused items can be returned within 45 days of delivery.</p></div>
          <div className="hx-src"><span className="hx-src-h"><Icon name="quote" size={13}/>Returns policy<em>returns.md</em></span><q>Unused items can be returned <mark>within 45 days of delivery</mark> for a full refund.</q></div>
          <ul className="hx-checks"><li><Icon name="check" size={12} strokeWidth={3}/>Quote matches the source</li><li><Icon name="check" size={12} strokeWidth={3}/>Grounding check passed</li></ul>
        </div>
        <div className="hx-float hx-float-r" aria-hidden="true"><span className="hx-float-ic"><Icon name="creditcard" size={15}/></span><span><b>Billing, read-only</b><small>Invoice AP-1001 · Paid</small></span></div>
      </div>
      <div className="hx-works vp-anim" style={{'--d':'0.85s'} as React.CSSProperties}><span>Installs on</span><ul>{['WordPress','Shopify','Webflow','Wix','Squarespace','Next.js','Google Tag Manager'].map(n=><li key={n}>{n}</li>)}</ul></div>
    </div>
    <noscript><style>{'.vp-anim,.hx-line>span,.hx-card *,.hx-float,.vp-header{animation:none!important;opacity:1!important;transform:none!important;filter:none!important}.hx-typing{display:none}'}</style></noscript>
  </section>

  <section id="demo" className="hm-sec hm-demo" aria-labelledby="demo-title">
    <BotDemo/>
  </section>

  

  <section id="how" className="hm-sec hm-how" aria-labelledby="how-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">02 / How every answer is made</p>
      <h2 id="how-title" className="hm-h2">No source, <span className="ap-hl">no answer</span>.</h2>
      <p className="hm-lede">Every reply goes through the same four steps: ask, retrieve, quote, verify. If any step fails, nothing goes to the customer, and your team gets a review item with the full conversation.</p>
    </div>
    <div className="ap-rv" style={stagger(1)}><AnswerPipeline/></div>
  </section>


  <section id="features" className="hm-sec hm-features" aria-labelledby="features-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">03 / Platform</p>
      <h2 id="features-title" className="hm-h2">Everything you need to hand support to AI, <span className="ap-hl">safely</span>.</h2>
      <p className="hm-lede">From the first doc you import to the last ticket you close, you can see what the agent did and step in at any point.</p>
    </div>
    <div className="hm-bento">
      {FEATURES.map((f,i)=>(<div key={f.title} className={'hm-cell ap-rv'+(f.wide?' hm-card-wide':'')} style={stagger(i%3)}><article className="hm-card" onPointerMove={spot}>
        <div className="hm-card-visual">{f.visual}</div>
        <div className="hm-card-copy"><div className="hm-card-title"><span className="hm-card-icon"><PlatformGlyph name={f.icon}/></span><h3>{f.title}</h3></div><p>{f.body}</p></div>
      </article></div>))}
    </div>
  </section>

  <OwnerView/>

  <section id="addons" className="hm-sec hm-addons-sec" aria-labelledby="addons-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">05 / Add-ons and integrations</p>
      <h2 id="addons-title" className="hm-h2">Connect the tools your team already uses.</h2>
      <p className="hm-lede">Start with the built-in service desk, then add what you need. Each add-on is labelled available or in preview, so you know what works today.</p>
    </div>
    <AddOns/>
  </section>

  


  <section id="trust" className="hm-sec hm-trust" aria-labelledby="trust-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">06 / Trust</p>
      <h2 id="trust-title" className="hm-h2">The controls your security review will ask about.</h2>
      <p className="hm-lede">Built in from day one and covered by automated tests, not bolted on after launch.</p>
    </div>
    <ul className="hm-trust-grid">
      {TRUST.map((t,i)=>(<li key={t.title} className="ap-rv" style={stagger(i%3)}><div className="hm-trust-item"><span className="hm-trust-icon"><Icon name={t.icon} size={18}/></span><h3>{t.title}</h3><p>{t.body}</p></div></li>))}
    </ul>
    <p className="hm-trust-note ap-rv">{modeText('Public preview on fictional data. Live payments stay off, and SOC 2, HIPAA and uptime SLAs are not yet claimed.','Billing stays read-only and live payments stay off. SOC 2, HIPAA and uptime SLAs are not claimed.')} <Link href="/status">Preview status ↗</Link></p>
  </section>

  <section id="faq" className="hm-sec hm-faq" aria-labelledby="faq-title">
    <div className="hm-faq-grid">
      <div className="hm-head ap-rv">
        <p className="hm-kicker">07 / Questions</p>
        <h2 id="faq-title" className="hm-h2">Questions, answered.</h2>
        <p className="hm-lede">Setup steps, provider keys and the MCP tools are in the <Link href="/docs" className="hm-inline-link hm-nowrap">docs ↗</Link>. Have a question we didn’t cover? <Link href="/contact" className="hm-inline-link hm-nowrap">Send it to us ↗</Link> and a person will read it.</p>
      </div>
      <div className="hm-faq-list">{FAQ.map(([q,a])=><details key={q} className="hm-faq-item"><summary>{q}<span aria-hidden="true"/></summary><p>{a}</p></details>)}</div>
    </div>
  </section>

  <section className="ap-start"><p className="ap-kicker">{modeText('Free preview. Fictional data. Real workflow.','Free to start. Read-only billing. A person in control.')}</p><h2>Turn your docs into<br className="hm-br-wide"/> a support agent you can check.</h2><Link href="/setup" className="ap-beam-btn"><span>Start the guided setup <span>↗</span></span></Link><p>Sign in → add a source → test it → paste one script tag.</p></section>
  <footer className="ap-footer"><div className="ap-footer-grid"><div className="ap-footer-brand"><Link className="ap-mark" href="/"><Image src="/automatepal-logo.png" alt="" width={57} height={28} className="ap-logo"/>AutomatePal</Link><p>Source-quoted AI support<br/>with a person in control.</p><p className="ap-footer-note">{modeText('Fictional-data preview. No live payments. No uptime, SLA or certification claim.','No live payments. No uptime, SLA or certification claim.')}</p></div><nav className="ap-footer-col" aria-label="Product"><h3>Product</h3><a href="#how">How it works</a><a href="#features">Platform</a><a href="#trust">Trust</a><a href="#addons">Add-ons</a><a href="#faq">FAQ</a><Link href="/pricing">Pricing</Link><Link href="/docs">Docs</Link></nav><nav className="ap-footer-col" aria-label="Get started"><h3>Get started</h3><Link href="/setup">Guided setup</Link><Link href="/login">Sign in</Link><Link href="/support">One-hour demo</Link><Link href="/knowledge">Knowledge workspace</Link></nav><nav className="ap-footer-col" aria-label="Company"><h3>Company</h3><Link href="/status">Status</Link><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link><a href={REPO_URL} rel="noreferrer" target="_blank">GitHub</a></nav></div><FolderWordmark/><div className="ap-footer-bar"><span>© 2026 {COPYRIGHT_HOLDER}. AutomatePal - candidate preview build.</span><span>Answers quote their sources. A person keeps the final say.</span></div></footer></main></DeskShell>;}
