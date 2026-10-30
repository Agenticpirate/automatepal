'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import './video.css';

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
  ban: (<><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>),
  listchecks: (<><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></>),
  clock: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  arrowupright: (<><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>),
  sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></>),
};
function Icon({ name, size = 16, strokeWidth = 2 }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

type Stat = { icon: keyof typeof PATHS; target: number; suffix: string; decimals: number; label: string };
const STATS: Stat[] = [
  { icon: 'quote', target: 100, suffix: '%', decimals: 0, label: 'Answers quote a source' },
  { icon: 'ban', target: 0, suffix: '', decimals: 0, label: 'Guesses sent to customers' },
  { icon: 'listchecks', target: 3, suffix: '', decimals: 0, label: 'Steps to a live demo' },
  { icon: 'clock', target: 1, suffix: 'hr', decimals: 0, label: 'Typical demo setup' },
];
const NAV: { label: string; href: string; icon: keyof typeof PATHS; active?: boolean }[] = [
  { label: 'Home', href: '/', icon: 'home', active: true },
  { label: 'Product', href: '/#workflow', icon: 'grid' },
  { label: 'Pricing', href: '/pricing', icon: 'tag' },
  { label: 'Contact', href: '/contact', icon: 'mail' },
];

function useCountUp(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const values = Array.from(root.querySelectorAll<HTMLElement>('[data-target]'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const setFinal = (el: HTMLElement) => {
      const t = parseFloat(el.dataset.target || '0');
      const d = Number(el.dataset.decimals || '0');
      el.textContent = t.toFixed(d) + (el.dataset.suffix || '');
    };
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

export default function VideoPreviewPage() {
  const [open, setOpen] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);
  useCountUp(statsRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onResize = () => { if (window.innerWidth > 720) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="vp">
      <div className="vp-bg" aria-hidden="true">
        {/* Spec video (rights unconfirmed - swap in only after Ravi confirms license):
        <video className="vp-bg-video" autoPlay muted loop playsInline>
          <source src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4" type="video/mp4" />
        </video> */}
      </div>
      <div className="vp-bg-tint" aria-hidden="true" />
      <div className="vp-page">
        <header className={open ? 'vp-header vp-open' : 'vp-header'}>
          <Link href="/" className="vp-logo" aria-label="AutomatePal home">
            <Image src="/automatepal-logo.png" alt="" width={104} height={51} />
          </Link>
          <nav className="vp-nav" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.label} href={n.href} className={n.active ? 'vp-active' : undefined}>
                <Icon name={n.icon} size={14} />{n.label}
              </Link>
            ))}
          </nav>
          <Link href="/login" className="vp-signin"><Icon name="login" size={14} />Sign in</Link>
          <button className="vp-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>
            <i /><i /><i />
          </button>
        </header>

        {open && (
          <>
            <div className="vp-overlay" onClick={() => setOpen(false)} />
            <nav className="vp-sheet" aria-label="Mobile">
              {NAV.map((n, i) => (
                <Link key={n.label} href={n.href} className={n.active ? 'vp-active' : undefined}
                  style={{ animationDelay: `${0.05 + i * 0.05}s` }} onClick={() => setOpen(false)}>
                  <Icon name={n.icon} size={15} />{n.label}
                </Link>
              ))}
              <Link href="/login" className="vp-sheet-signin" style={{ animationDelay: '0.25s' }} onClick={() => setOpen(false)}>
                <Icon name="login" size={15} />Sign in
              </Link>
            </nav>
          </>
        )}

        <main className="vp-hero">
          <div className="vp-trust vp-anim" style={{ ['--d' as string]: '0.05s' } as React.CSSProperties}>
            <span className="vp-ring"><span aria-label="Source quotes"><Icon name="quote" size={15} strokeWidth={2.2} /></span></span>
            <span className="vp-ring"><span aria-label="Owner review"><Icon name="shieldcheck" size={15} strokeWidth={2.2} /></span></span>
            <span className="vp-ring"><span aria-label="A person in control"><Icon name="usercheck" size={15} strokeWidth={2.2} /></span></span>
            <span className="vp-trust-pill"><Icon name="sparkles" size={13} />Source-quoted answers, owner in control</span>
          </div>
          <h1 className="vp-headline">
            <span>Every question answered.</span>
            <span>Every miss handled.</span>
          </h1>
          <p className="vp-sub vp-anim" style={{ ['--d' as string]: '0.28s' } as React.CSSProperties}>
            Answers built from your own sources, with the quote attached. Anything uncertain routes to your review - never a guess to your customer.
          </p>
          <Link href="/setup" className="vp-cta vp-anim" style={{ ['--d' as string]: '0.4s', animationName: 'vp-revealPulse' } as React.CSSProperties}>
            Start building <span className="vp-cta-arrow"><Icon name="arrowupright" size={14} strokeWidth={2.4} /></span>
          </Link>
        </main>

        <div className="vp-stats" ref={statsRef}>
          {STATS.map((s, i) => (
            <div className="vp-stat vp-anim" key={s.label} style={{ ['--d' as string]: `${0.5 + i * 0.08}s` } as React.CSSProperties}>
              <span className="vp-stat-icon" aria-hidden="true"><Icon name={s.icon} size={26} strokeWidth={1.9} /></span>
              <span className="vp-stat-value" data-target={s.target} data-suffix={s.suffix} data-decimals={s.decimals}>0{s.suffix}</span>
              <span className="vp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
      <noscript><style>{'.vp-anim,.vp-headline span,.vp-header{animation:none;opacity:1;transform:none;filter:none}'}</style></noscript>
    </div>
  );
}
