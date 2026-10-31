'use client';
import Link from 'next/link';import Image from 'next/image';import {useEffect,useRef,useState} from 'react';import DeskShell from './components/DeskShell';
import AnswerPipeline from './components/home/AnswerPipeline';
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
};
function Icon({ name, size = 16, strokeWidth = 2 }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>);
}
type Stat = { icon: keyof typeof PATHS; target: number; suffix: string; decimals: number; label: string };
const STATS: Stat[] = [
  { icon: 'quote', target: 100, suffix: '%', decimals: 0, label: 'Answers cite a source' },
  { icon: 'ban', target: 0, suffix: '', decimals: 0, label: 'Guesses sent to customers' },
  { icon: 'listchecks', target: 3, suffix: '', decimals: 0, label: 'Steps to a live widget' },
  { icon: 'clock', target: 1, suffix: 'hr', decimals: 0, label: 'Typical setup' },
];
const VP_NAV: { label: string; href: string; icon: keyof typeof PATHS; active?: boolean }[] = [
  { label: 'Home', href: '/', icon: 'home', active: true },
  { label: 'Product', href: '#features', icon: 'grid' },
  { label: 'Trust', href: '#trust', icon: 'shieldcheck' },
  { label: 'Pricing', href: '/pricing', icon: 'tag' },
];
/* Capability strip: every item is a shipped preview feature (see FEATURES.md). */
const CAPABILITIES = ['Exact source quotes','Independent grounding check','Impact × urgency priority','Human takeover','Effective-dated owner exceptions','Exact custom answers','PDF, Markdown and URL import','Consent-gated publishing','Origin and path rules','Signed webhooks','Scoped, expiring API tokens','Row-level tenant isolation','Unanswered-question CSV','Tested in English, Hindi and Telugu'];
type Feature = { icon: keyof typeof PATHS; title: string; body: string; wide?: boolean; visual: React.ReactNode };
const FEATURES: Feature[] = [
  { icon: 'quote', wide: true, title: 'Answers that cite their source', body: 'Every reply carries the exact passage it came from, so customers and your team can check it. A separate grounding check must agree before anything is sent.',
    visual: <div className="hm-v-chat"><p className="hm-v-ask">How many seats are in the student plan?</p><p className="hm-v-reply">The student plan includes 25 seats.</p><blockquote className="hm-v-quote"><p>“…the North Dock student plan includes <mark>25 seats</mark>.”</p><span>Student plan exception · grounding passed</span></blockquote><div className="hm-v-langs" aria-label="Tested languages"><span>EN</span><span>HI</span><span>TE</span></div></div> },
  { icon: 'inbox', title: 'A review queue built for service teams', body: 'Incidents, requests and questions with a 3×3 impact and urgency matrix, guarded status changes and private notes.',
    visual: <ul className="hm-v-rows"><li><b>Incident</b>Checkout error<em data-tone="hot">High · urgent</em></li><li><b>Request</b>Refund review<em>Owner decision</em></li><li><b>Question</b>Student plan seats<em data-tone="ok">Answered</em></li></ul> },
  { icon: 'usercheck', title: 'Step in at any moment', body: 'Take over a conversation, pause in-flight AI answers, then release or resolve it.',
    visual: <div className="hm-v-toggle"><span className="hm-v-switch" aria-hidden="true"><i/></span><span className="hm-v-toggle-a">AI answering</span><span className="hm-v-toggle-b">You have control</span></div> },
  { icon: 'sliders', title: 'Guidance the AI follows', body: 'Add exceptions with effective dates, or exact answers for questions you never want paraphrased.',
    visual: <div className="hm-v-chips"><span><b>Exception</b>Nov 1 – Dec 31 · 25 seats</span><span><b>Exact answer</b>“What are your hours?”</span></div> },
  { icon: 'filetext', title: 'Knowledge you approve', body: 'Import text, Markdown, PDFs or a public URL. Nothing answers a customer until you consent and publish.',
    visual: <ul className="hm-v-files"><li><Icon name="check" size={12} strokeWidth={3}/>pricing.pdf<em>Published</em></li><li><Icon name="check" size={12} strokeWidth={3}/>faq.md<em>Published</em></li><li data-pending="true"><Icon name="clock" size={12} strokeWidth={2.4}/>help.example.com/returns<em>In review</em></li></ul> },
  { icon: 'appwindow', title: 'Your widget, your brand', body: 'Colors, starter questions, placement, allowed origins and excluded paths. Optional lead capture asks for consent.',
    visual: <div className="hm-v-widget"><span className="hm-v-swatches" aria-hidden="true"><i/><i/><i/></span><span className="hm-v-launcher" aria-hidden="true"><Icon name="sparkles" size={14}/></span></div> },
  { icon: 'barchart', title: 'See what’s missing', body: 'Unanswered questions, answer feedback and seven-day trends, with a formula-safe CSV export.',
    visual: <div className="hm-v-bars" aria-label="Illustrative unanswered questions"><span style={{'--w':'86%'} as React.CSSProperties}>Shipping to Canada</span><span style={{'--w':'62%'} as React.CSSProperties}>Team discounts</span><span style={{'--w':'38%'} as React.CSSProperties}>Invoice copies</span><em>Illustrative</em></div> },
  { icon: 'code', title: 'Built for your stack', body: 'Read-only API tokens that are scoped, expiring and revocable, plus webhooks signed with HMAC-SHA256.',
    visual: <pre className="hm-v-code" aria-label="Example token and webhook settings"><span>token</span>  ••••••  <i>support</i> <i>24h</i>{'\n'}<span>webhook</span> HMAC-SHA256(ts + body)</pre> },
];
const TRUST: { icon: keyof typeof PATHS; title: string; body: string }[] = [
  { icon: 'database', title: 'Tenant isolation', body: 'Postgres row-level security separates every workspace. Tests deny cross-tenant reads, forged writes and foreign RPC calls.' },
  { icon: 'key', title: 'Scoped, expiring tokens', body: 'API tokens are hashed at rest, limited to five per owner, scoped, revocable and valid for 1 to 168 hours.' },
  { icon: 'send', title: 'Signed webhooks', body: 'Each delivery is signed with HMAC-SHA256 over its timestamp and raw body, with bounded retries.' },
  { icon: 'history', title: 'Metadata-only audit', body: 'Owner actions are recorded as metadata. Message bodies and source text stay out of logs.' },
  { icon: 'gauge', title: 'Abuse budgets', body: 'Per-conversation and daily answer budgets are enforced before any model call, and refusals count.' },
  { icon: 'shieldcheck', title: 'Consent and deletion', body: 'Knowledge needs explicit processing and publishing consent. Owners can delete their workspace data themselves.' },
];
function useCountUp(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const values = Array.from(root.querySelectorAll<HTMLElement>('[data-target]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const setFinal = (el: HTMLElement) => { const t = parseFloat(el.dataset.target || '0'); const d = Number(el.dataset.decimals || '0'); el.textContent = t.toFixed(d) + (el.dataset.suffix || ''); };
    if (reduced) { values.forEach(setFinal); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        const el = entry.target as HTMLElement;
        const i = values.indexOf(el);
        const target = parseFloat(el.dataset.target || '0');
        const decimals = Number(el.dataset.decimals || '0');
        const suffix = el.dataset.suffix || '';
        const duration = 1500 + i * 80;
        const offset = 480 + i * 90;
        window.setTimeout(() => {
          const start = performance.now();
          const tick = (now: number) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = (target * eased).toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, offset);
      });
    }, { threshold: 0.25 });
    values.forEach((v) => io.observe(v));
    return () => io.disconnect();
  }, [ref]);
}
/* Cursor spotlight on feature cards: mouse only, sets the card's own variables. */
function spot(e: React.PointerEvent<HTMLElement>) {
  if (e.pointerType !== 'mouse') return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}
const examples=[{question:'How many seats are in the student plan?',answer:'The fictional North Dock student plan includes 25 seats.',source:'Student plan exception · fictional source',type:'Answer with a source',ticket:'No review request created'},{question:'Can someone review my refund request?',answer:'This needs an owner review. No refund has been issued.',source:'Human review · no automatic money movement',type:'Owner review needed',ticket:'Service request · refund review · pending'}];
export default function Landing(){
  const[example,setExample]=useState(0),[sent,setSent]=useState(false),[open,setOpen]=useState(false);
  const statsRef=useRef<HTMLDivElement>(null);useCountUp(statsRef);
  useEffect(()=>{const els=Array.from(document.querySelectorAll('.ap-rv'));els.forEach(el=>el.classList.add('ap-rv-off'));const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('ap-rv-in');io.unobserve(e.target);}}),{threshold:.18});els.forEach(el=>io.observe(el));return()=>io.disconnect();},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};const onResize=()=>{if(window.innerWidth>720)setOpen(false);};window.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);};},[]);
  const d=examples[example];
  const stagger=(i:number)=>({'--i':i} as React.CSSProperties);
  return <DeskShell widget darkDefault><main id="main-content" className="ap-public ap-home"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"WebSite",name:"AutomatePal",url:"https://automatepal.onrender.com/",description:"Source-quoted AI customer support with an owner-reviewed service desk. Fictional-data preview, no live payments."}).replace(/</g,"\\u003c")}}/>
  <section className="vp vp-static" aria-label="Intro">
    <div className="vp-bg" aria-hidden="true"/><div className="vp-bg-tint" aria-hidden="true"/>
    <div className="vp-page">
      <header className={open?'vp-header vp-open':'vp-header'}>
        <Link href="/" className="vp-logo" aria-label="AutomatePal home"><Image src="/automatepal-logo.png" alt="" width={104} height={51} priority/></Link>
        <nav className="vp-nav" aria-label="Primary">{VP_NAV.map(n=>(<Link key={n.label} href={n.href} className={n.active?'vp-active':undefined}><Icon name={n.icon} size={14}/>{n.label}</Link>))}</nav>
        <Link href="/login" className="vp-signin"><Icon name="login" size={14}/>Sign in</Link>
        <button className="vp-burger" aria-label="Menu" aria-expanded={open} onClick={()=>setOpen(!open)}><i/><i/><i/></button>
      </header>
      {open&&(<><div className="vp-overlay" onClick={()=>setOpen(false)}/><nav className="vp-sheet" aria-label="Mobile">{VP_NAV.map((n,i)=>(<Link key={n.label} href={n.href} className={n.active?'vp-active':undefined} style={{animationDelay:`${0.05+i*0.05}s`}} onClick={()=>setOpen(false)}><Icon name={n.icon} size={15}/>{n.label}</Link>))}<Link href="/login" className="vp-sheet-signin" style={{animationDelay:'0.25s'}} onClick={()=>setOpen(false)}><Icon name="login" size={15}/>Sign in</Link></nav></>)}
      <div className="vp-hero">
        <div className="vp-trust vp-anim" style={{'--d':'0.05s'} as React.CSSProperties}>
          <span className="vp-ring"><span aria-label="Source quotes"><Icon name="quote" size={15} strokeWidth={2.2}/></span></span>
          <span className="vp-ring"><span aria-label="Owner review"><Icon name="shieldcheck" size={15} strokeWidth={2.2}/></span></span>
          <span className="vp-ring"><span aria-label="A person in control"><Icon name="usercheck" size={15} strokeWidth={2.2}/></span></span>
          <span className="vp-trust-pill"><Icon name="sparkles" size={13}/>AI support that shows its work</span>
        </div>
        <h1 className="vp-headline"><span>Every question answered.</span><span>Every miss handled.</span></h1>
        <p className="vp-sub vp-anim" style={{'--d':'0.28s'} as React.CSSProperties}>AutomatePal answers customers from your own knowledge and attaches the exact passage it used. When the source isn’t there, the question goes to your review queue instead of becoming a guess.</p>
        <div className="hm-hero-ctas vp-anim" style={{'--d':'0.4s'} as React.CSSProperties}>
          <Link href="/setup" className="vp-cta" style={{animationName:'vp-revealPulse'} as React.CSSProperties}>Start building <span className="vp-cta-arrow"><Icon name="arrowupright" size={14} strokeWidth={2.4}/></span></Link>
          <a href="#how" className="hm-cta-ghost">See how it works <Icon name="arrowright" size={14}/></a>
        </div>
      </div>
      <div className="vp-stats" ref={statsRef}>
        {STATS.map((s,i)=>(<div className="vp-stat vp-anim" key={s.label} style={{'--d':`${0.5+i*0.08}s`} as React.CSSProperties}><span className="vp-stat-icon" aria-hidden="true"><Icon name={s.icon} size={26} strokeWidth={1.9}/></span><span className="vp-stat-value" data-target={s.target} data-suffix={s.suffix} data-decimals={s.decimals}>0{s.suffix}</span><span className="vp-stat-label">{s.label}</span></div>))}
      </div>
      <div className="hm-marquee vp-anim" style={{'--d':'0.85s'} as React.CSSProperties} aria-label="Capabilities">
        <ul className="hm-marquee-track">{CAPABILITIES.map(c=><li key={c}>{c}</li>)}</ul>
        <ul className="hm-marquee-track" aria-hidden="true">{CAPABILITIES.map(c=><li key={c}>{c}</li>)}</ul>
      </div>
    </div>
    <noscript><style>{'.vp-anim,.vp-headline span,.vp-header{animation:none;opacity:1;transform:none;filter:none}'}</style></noscript>
  </section>

  <section id="how" className="hm-sec hm-how" aria-labelledby="how-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">01 / How every answer is made</p>
      <h2 id="how-title" className="hm-h2">Grounded answers, <span className="ap-hl">by design</span>.</h2>
      <p className="hm-lede">Each reply passes the same checks before a customer sees it. If any check fails, nothing is sent and your team gets a review item with the full context.</p>
    </div>
    <div className="ap-rv" style={stagger(1)}><AnswerPipeline/></div>
  </section>

  <section id="specimen" className="ap-spec-sec" aria-label="Interactive specimen">
    <div className="ap-specimen"><div className="ap-specimen-caption"><span>02 / Try it</span><span>Interactive specimen</span></div><div className="ap-specimen-window"><div className="ap-demo-top"><span className="ap-demo-avatar">N</span><div><strong>North Dock</strong><p>Fictional help desk</p></div><span className="ap-demo-state">Preview</span></div><div className="ap-demo-conversation"><p className="ap-demo-welcome">A useful answer.<br/>Or the right next step.</p><label htmlFor="demo-scenario">Choose a fictional question</label><select id="demo-scenario" value={example} onChange={e=>{setExample(Number(e.target.value));setSent(false);}}>{examples.map((x,i)=><option value={i} key={x.question}>{x.question}</option>)}</select><button className="ap-demo-submit" onClick={()=>setSent(true)}>Try this question <span>↗</span></button>{sent?<div className="ap-demo-answer" role="status"><p className="ap-kicker">{d.type}</p><p>{d.answer}</p><details><summary>{d.source}</summary><p>{example===0?'Fictional source text: "The North Dock student plan includes 25 seats."':'A person must review sensitive requests. This local illustration does not submit a ticket or send a message.'}</p></details></div>:<div className="ap-demo-empty"><span>Knowledge → answer → review</span><p>Try either path. Nothing leaves this page.</p></div>}</div><div className="ap-demo-footer"><span>{sent?d.ticket:'Source-backed help, with an owner in control.'}</span></div></div><div className="ap-gauge-card"><svg viewBox="0 0 72 72" width="58" height="58" role="img" aria-label="Fictional gauge showing 94 percent"><circle cx="36" cy="36" r="30" className="ap-gauge-track"/><circle cx="36" cy="36" r="30" className="ap-gauge-fill"/><text x="36" y="41" textAnchor="middle" className="ap-gauge-num">94%</text></svg><div><strong>Reviewed on time</strong><p>Fictional stat</p></div></div><p className="ap-specimen-note">Local interaction, not a live AI answer or customer record. <Link href="/support">Create your one-hour live widget demo ↗</Link></p></div>
  </section>

  <section id="features" className="hm-sec hm-features" aria-labelledby="features-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">03 / Platform</p>
      <h2 id="features-title" className="hm-h2">Everything a support team needs to trust its AI.</h2>
      <p className="hm-lede">From the first imported source to the last resolved ticket, every step stays visible and under your control.</p>
    </div>
    <div className="hm-bento">
      {FEATURES.map((f,i)=>(<div key={f.title} className={'hm-cell ap-rv'+(f.wide?' hm-card-wide':'')} style={stagger(i%3)}><article className="hm-card" onPointerMove={spot}>
        <div className="hm-card-visual">{f.visual}</div>
        <div className="hm-card-copy"><span className="hm-card-icon"><Icon name={f.icon} size={16}/></span><h3>{f.title}</h3><p>{f.body}</p></div>
      </article></div>))}
    </div>
  </section>

  <section id="workflow" className="ap-flow"><div className="ap-section-label"><span>04 / Go live</span><p>Three steps to live.<br/>Visible at every one.</p></div><div className="ap-flow-steps"><article><span>01</span><div><h3>Bring your sources.</h3><p>Paste reference text, upload a PDF or Markdown file, or import a public URL. You review everything before it can answer anyone.</p><Link href="/knowledge">Knowledge workspace ↗</Link></div></article><article><span>02</span><div><h3>Shape the answers.</h3><p>Test questions against your sources, add exceptions and exact answers, and set the widget’s look, starters and allowed sites.</p><Link href="/support">Widget studio ↗</Link></div></article><article><span>03</span><div><h3>Launch and stay in charge.</h3><p>Embed one script. Work a focused queue with impact and urgency, take over conversations and record refund-review decisions.</p><Link href="/tickets">Ticket workspace ↗</Link></div></article></div></section>

  <section className="ap-product"><div className="ap-product-head"><div><p className="ap-kicker">05 / The owner’s view</p><h2>See what needs you.<br/>Skip the rest.</h2></div><p>The queue, unanswered questions and handoffs in one quiet overview, with interventions, drafts and the full record one click away.</p></div><div className="hm-clip ap-rv"><div className="ap-product-frame"><div className="ap-product-bar"><span className="ap-chrome-dots" aria-hidden="true"><i/><i/><i/></span><span className="ap-chrome-url">AutomatePal / owner overview</span><span className="ap-chrome-tag">Rendered product · fictional test data</span></div><div className="ap-product-crop"><Image src="/product-owner-dark.png" alt="Actual AutomatePal owner overview rendered with fictional test data, including intervention counts, questions and draft rules." width={1280} height={2183}/></div></div></div><Link href="/owner" className="ap-text-link">Open the owner overview ↗</Link></section>

  <section id="trust" className="hm-sec hm-trust" aria-labelledby="trust-title">
    <div className="hm-head ap-rv">
      <p className="hm-kicker">06 / Trust</p>
      <h2 id="trust-title" className="hm-h2">Controls your security review will ask about.</h2>
      <p className="hm-lede">Built in from the start and covered by automated tests, not added after launch.</p>
    </div>
    <ul className="hm-trust-grid">
      {TRUST.map((t,i)=>(<li key={t.title} className="ap-rv" style={stagger(i%3)}><div className="hm-trust-item"><span className="hm-trust-icon"><Icon name={t.icon} size={18}/></span><h3>{t.title}</h3><p>{t.body}</p></div></li>))}
    </ul>
    <p className="hm-trust-note ap-rv">Public preview on fictional data. Live payments stay off, and SOC 2, HIPAA and uptime SLAs are not yet claimed. <Link href="/status">Preview status ↗</Link></p>
  </section>

  <section className="ap-start"><p className="ap-kicker">Free sandbox. Fictional data. Real workflow.</p><h2>Your AI support desk is<br/>about an hour away.</h2><Link href="/setup" className="ap-beam-btn"><span>Start the guided setup <span>↗</span></span></Link><p>Sign in → add a source → review → launch your widget.</p></section>
  <footer className="ap-footer"><div className="ap-footer-grid"><div className="ap-footer-brand"><Link className="ap-mark" href="/"><Image src="/automatepal-logo.png" alt="" width={57} height={28} className="ap-logo"/>AutomatePal</Link><p>Source-quoted AI support<br/>with a person in control.</p><p className="ap-footer-note">Fictional-data preview. No live payments. No uptime, SLA or certification claim.</p></div><nav className="ap-footer-col" aria-label="Product"><h3>Product</h3><a href="#how">How it works</a><a href="#features">Platform</a><a href="#trust">Trust</a><Link href="/pricing">Sandbox pricing</Link></nav><nav className="ap-footer-col" aria-label="Get started"><h3>Get started</h3><Link href="/setup">Guided setup</Link><Link href="/login">Sign in</Link><Link href="/support">One-hour demo</Link><Link href="/knowledge">Knowledge workspace</Link></nav><nav className="ap-footer-col" aria-label="Company"><h3>Company</h3><Link href="/status">Status</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link></nav></div><div className="ap-footer-bar"><span>AutomatePal - candidate preview build.</span><span>Answers quote their sources. A person keeps the final say.</span></div></footer></main></DeskShell>;}
