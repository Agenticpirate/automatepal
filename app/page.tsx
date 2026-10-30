'use client';
import Link from 'next/link';import Image from 'next/image';import {useEffect,useRef,useState} from 'react';import DeskShell from './components/DeskShell';
import './preview/video/video.css';

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
  sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l-1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275 1.275L12 3Z"/></>),
};
function Icon({ name, size = 16, strokeWidth = 2 }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number }) {
  return (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>);
}
type Stat = { icon: keyof typeof PATHS; target: number; suffix: string; decimals: number; label: string };
const STATS: Stat[] = [
  { icon: 'quote', target: 100, suffix: '%', decimals: 0, label: 'Answers quote a source' },
  { icon: 'ban', target: 0, suffix: '', decimals: 0, label: 'Guesses sent to customers' },
  { icon: 'listchecks', target: 3, suffix: '', decimals: 0, label: 'Steps to a live demo' },
  { icon: 'clock', target: 1, suffix: 'hr', decimals: 0, label: 'Typical demo setup' },
];
PATHS.ban = (<><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>);
const VP_NAV: { label: string; href: string; icon: keyof typeof PATHS; active?: boolean }[] = [
  { label: 'Home', href: '/', icon: 'home', active: true },
  { label: 'Product', href: '#workflow', icon: 'grid' },
  { label: 'Pricing', href: '/pricing', icon: 'tag' },
  { label: 'Contact', href: '/contact', icon: 'mail' },
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
const examples=[{question:'How many seats are in the student plan?',answer:'The fictional North Dock student plan includes 25 seats.',source:'Student plan exception · fictional source',type:'Answer with a source',ticket:'No review request created'},{question:'Can someone review my refund request?',answer:'This needs an owner review. No refund has been issued.',source:'Human review · no automatic money movement',type:'Owner review needed',ticket:'Service request · refund review · pending'}];
export default function Landing(){
  const[example,setExample]=useState(0),[sent,setSent]=useState(false),[open,setOpen]=useState(false);
  const statsRef=useRef<HTMLDivElement>(null);useCountUp(statsRef);
  useEffect(()=>{const els=Array.from(document.querySelectorAll('.ap-rv'));els.forEach(el=>el.classList.add('ap-rv-off'));const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('ap-rv-in');io.unobserve(e.target);}}),{threshold:.18});els.forEach(el=>io.observe(el));return()=>io.disconnect();},[]);
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};const onResize=()=>{if(window.innerWidth>720)setOpen(false);};window.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);};},[]);
  const d=examples[example];
  return <DeskShell widget darkDefault><main id="main-content" className="ap-public"><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({"@context":"https://schema.org","@type":"WebSite",name:"AutomatePal",url:"https://automatepal.onrender.com/",description:"Source-backed support and owner-reviewed service desk. Fictional-data preview, no live payments."}).replace(/</g,"\\u003c")}}/>
  <section className="vp vp-static" aria-label="Intro">
    <div className="vp-bg" aria-hidden="true"/><div className="vp-bg-tint" aria-hidden="true"/>
    <div className="vp-page">
      <header className={open?'vp-header vp-open':'vp-header'}>
        <Link href="/" className="vp-logo" aria-label="AutomatePal home"><Image src="/automatepal-mark.svg" alt="" width={52} height={52}/></Link>
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
          <span className="vp-trust-pill"><Icon name="sparkles" size={13}/>Source-quoted answers, owner in control</span>
        </div>
        <h1 className="vp-headline"><span>Every question answered.</span><span>Every miss handled.</span></h1>
        <p className="vp-sub vp-anim" style={{'--d':'0.28s'} as React.CSSProperties}>Answers built from your own sources, with the quote attached. Anything uncertain routes to your review - never a guess to your customer.</p>
        <Link href="/setup" className="vp-cta vp-anim" style={{'--d':'0.4s',animationName:'vp-revealPulse'} as React.CSSProperties}>Start building <span className="vp-cta-arrow"><Icon name="arrowupright" size={14} strokeWidth={2.4}/></span></Link>
      </div>
      <div className="vp-stats" ref={statsRef}>
        {STATS.map((s,i)=>(<div className="vp-stat vp-anim" key={s.label} style={{'--d':`${0.5+i*0.08}s`} as React.CSSProperties}><span className="vp-stat-icon" aria-hidden="true"><Icon name={s.icon} size={26} strokeWidth={1.9}/></span><span className="vp-stat-value" data-target={s.target} data-suffix={s.suffix} data-decimals={s.decimals}>0{s.suffix}</span><span className="vp-stat-label">{s.label}</span></div>))}
      </div>
    </div>
    <noscript><style>{'.vp-anim,.vp-headline span,.vp-header{animation:none;opacity:1;transform:none;filter:none}'}</style></noscript>
  </section>
  <section id="specimen" className="ap-spec-sec" aria-label="Interactive specimen">
    <div className="ap-specimen"><div className="ap-specimen-caption"><span>01 / Support in context</span><span>Interactive specimen</span></div><div className="ap-specimen-window"><div className="ap-demo-top"><span className="ap-demo-avatar">N</span><div><strong>North Dock</strong><p>Fictional help desk</p></div><span className="ap-demo-state">Preview</span></div><div className="ap-demo-conversation"><p className="ap-demo-welcome">A useful answer.<br/>Or the right next step.</p><label htmlFor="demo-scenario">Choose a fictional question</label><select id="demo-scenario" value={example} onChange={e=>{setExample(Number(e.target.value));setSent(false);}}>{examples.map((x,i)=><option value={i} key={x.question}>{x.question}</option>)}</select><button className="ap-demo-submit" onClick={()=>setSent(true)}>Try this question <span>↗</span></button>{sent?<div className="ap-demo-answer" role="status"><p className="ap-kicker">{d.type}</p><p>{d.answer}</p><details><summary>{d.source}</summary><p>{example===0?'Fictional source text: "The North Dock student plan includes 25 seats."':'A person must review sensitive requests. This local illustration does not submit a ticket or send a message.'}</p></details></div>:<div className="ap-demo-empty"><span>Knowledge → answer → review</span><p>Try either path. Nothing leaves this page.</p></div>}</div><div className="ap-demo-footer"><span>{sent?d.ticket:'Source-backed help, with an owner in control.'}</span></div></div><div className="ap-gauge-card"><svg viewBox="0 0 72 72" width="58" height="58" role="img" aria-label="Fictional gauge showing 94 percent"><circle cx="36" cy="36" r="30" className="ap-gauge-track"/><circle cx="36" cy="36" r="30" className="ap-gauge-fill"/><text x="36" y="41" textAnchor="middle" className="ap-gauge-num">94%</text></svg><div><strong>Reviewed on time</strong><p>Fictional stat</p></div></div><p className="ap-specimen-note">Local interaction, not a live AI answer or customer record. <Link href="/support">Create your one-hour live widget demo ↗</Link></p></div>
  </section>
<section className="ap-statement"><p>From question to resolution.</p><h2 className="ap-rv">Nothing falls through.<br/>Every question <span className="ap-hl">lands somewhere</span>.</h2><p className="ap-rv">Answers come from the knowledge you choose, with the supporting quote attached. Anything uncertain becomes a review item - impact, urgency and history intact - not a guess sent to your customer.</p></section><section id="workflow" className="ap-flow"><div className="ap-section-label"><span>02 / A deliberate workflow</span><p>Three steps to live.<br/>Visible at every one.</p></div><div className="ap-flow-steps"><article><span>01</span><div><h3>Bring one source.</h3><p>Paste public or fictional reference text - or import a public URL. You review everything before it can answer anyone.</p><Link href="/knowledge">Knowledge workspace ↗</Link></div></article><article><span>02</span><div><h3>Answers quote their sources.</h3><p>Every answer shows the passage it came from. Your guidance can add an exception. Missing information falls back to review - never to a made-up reply.</p></div></article><article><span>03</span><div><h3>You keep the final say.</h3><p>A focused queue with impact and urgency. Pause AI, add internal notes, record refund-review decisions. Nothing sends to a customer from here.</p><Link href="/tickets">Ticket workspace ↗</Link></div></article></div></section><section className="ap-product"><div className="ap-product-head"><div><p className="ap-kicker">03 / The owner’s view</p><h2>See what needs you.<br/>Skip the rest.</h2></div><p>The queue, unanswered questions and handoffs in one quiet overview - interventions, drafts and the full record one click away.</p></div><div className="ap-product-frame"><div className="ap-product-bar"><span className="ap-chrome-dots" aria-hidden="true"><i/><i/><i/></span><span className="ap-chrome-url">AutomatePal / owner overview</span><span className="ap-chrome-tag">Rendered product · fictional test data</span></div><div className="ap-product-crop"><Image src="/product-owner-dark.png" alt="Actual AutomatePal owner overview rendered with fictional test data, including intervention counts, questions and draft rules." width={1280} height={2183}/></div></div><Link href="/owner" className="ap-text-link">Open the private owner overview ↗</Link></section><section id="boundaries" className="ap-boundaries"><div><p className="ap-kicker">04 / Useful, without pretending.</p><h2>Control is<br/>part of the product.</h2><p>This is a working preview, not an enterprise service or a promise of perfect answers.</p></div><dl><div className="ap-rv"><dt>Sources, not certainty.</dt><dd>Tenant-scoped knowledge and conservative fallbacks. Relevant answers can still be missed.</dd></div><div className="ap-rv"><dt>Review, not execution.</dt><dd>Refund decisions are internal records. Live payments and automatic customer sends remain off.</dd></div><div className="ap-rv"><dt>Private by design.</dt><dd>Owner workspaces require sign-in. Demo links expire after one hour. Use only fictional or public data.</dd></div><div className="ap-rv"><dt>Limits, in plain sight.</dt><dd>Bounded quotas and history. The free hosting service can sleep. No uptime, SLA or certification claim.</dd></div></dl></section><section className="ap-start"><p className="ap-kicker">Free sandbox. Fictional data. Real workflow.</p><h2>Your live demo is<br/>about an hour away.</h2><Link href="/setup" className="ap-beam-btn"><span>Start the guided setup <span>↗</span></span></Link><p>Sign in → add a source → review → create a fictional widget demo.</p></section><footer className="ap-footer"><div className="ap-footer-grid"><div className="ap-footer-brand"><Link className="ap-mark" href="/"><Image src="/automatepal-mark.svg" alt="" width={32} height={32} className="ap-logo"/>AutomatePal</Link><p>A support and service-desk preview.<br/>Built for considered answers, with a person in control.</p><p className="ap-footer-note">Fictional-data preview. No live payments. No uptime, SLA or certification claim.</p></div><nav className="ap-footer-col" aria-label="Product"><h3>Product</h3><a href="#workflow">The workflow</a><Link href="/pricing">Sandbox pricing</Link><Link href="/owner">Owner overview</Link><Link href="/tickets">Ticket workspace</Link></nav><nav className="ap-footer-col" aria-label="Get started"><h3>Get started</h3><Link href="/setup">Guided setup</Link><Link href="/login">Sign in</Link><Link href="/support">One-hour demo</Link><Link href="/knowledge">Knowledge workspace</Link></nav><nav className="ap-footer-col" aria-label="Company"><h3>Company</h3><Link href="/status">Status</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/contact">Contact</Link></nav></div><div className="ap-footer-bar"><span>AutomatePal - candidate preview build.</span><span>Answers quote their sources. A person keeps the final say.</span></div></footer></main></DeskShell>;}
