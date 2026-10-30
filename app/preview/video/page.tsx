'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import './video.css';

type Stat = { icon: string; target: number; suffix: string; decimals: number; label: string };
const STATS: Stat[] = [
  { icon: '"', target: 100, suffix: '%', decimals: 0, label: 'Answers quote a source' },
  { icon: '*', target: 0, suffix: '', decimals: 0, label: 'Guesses sent to customers' },
  { icon: '#', target: 3, suffix: '', decimals: 0, label: 'Steps to a live demo' },
  { icon: '<', target: 1, suffix: 'hr', decimals: 0, label: 'Typical demo setup' },
];
const NAV = [
  { label: 'Home', href: '/', active: true },
  { label: 'Product', href: '/#workflow' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Contact', href: '/contact' },
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
            <Image src="/automatepal-mark.svg" alt="" width={52} height={52} />
          </Link>
          <nav className="vp-nav" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.label} href={n.href} className={n.active ? 'vp-active' : undefined}>{n.label}</Link>
            ))}
          </nav>
          <Link href="/login" className="vp-signin">Sign in</Link>
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
                  style={{ animationDelay: `${0.05 + i * 0.05}s` }} onClick={() => setOpen(false)}>{n.label}</Link>
              ))}
              <Link href="/login" className="vp-sheet-signin" style={{ animationDelay: '0.25s' }} onClick={() => setOpen(false)}>Sign in</Link>
            </nav>
          </>
        )}

        <main className="vp-hero">
          <div className="vp-trust vp-anim" style={{ ['--d' as string]: '0.05s' } as React.CSSProperties}>
            <span className="vp-ring"><span aria-label="Source quotes">&ldquo;</span></span>
            <span className="vp-ring"><span aria-label="Owner review">&#10003;</span></span>
            <span className="vp-ring"><span aria-label="A person in control">&#9829;</span></span>
            <span className="vp-trust-pill">Source-quoted answers, owner in control</span>
          </div>
          <h1 className="vp-headline">
            <span>Every question answered.</span>
            <span>Every miss handled.</span>
          </h1>
          <p className="vp-sub vp-anim" style={{ ['--d' as string]: '0.28s' } as React.CSSProperties}>
            Answers built from your own sources, with the quote attached. Anything uncertain routes to your review - never a guess to your customer.
          </p>
          <Link href="/setup" className="vp-cta vp-anim" style={{ ['--d' as string]: '0.4s', animationName: 'vp-revealPulse' } as React.CSSProperties}>
            Start building ↗
          </Link>
        </main>

        <div className="vp-stats" ref={statsRef}>
          {STATS.map((s, i) => (
            <div className="vp-stat vp-anim" key={s.label} style={{ ['--d' as string]: `${0.5 + i * 0.08}s` } as React.CSSProperties}>
              <span className="vp-stat-icon" aria-hidden="true">{s.icon}</span>
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
