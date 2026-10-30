'use client';
import {useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import DeskShell from '../components/DeskShell';
import './pricing.css';
import Gauge from '../components/Gauge';

/* Lucide (ISC) inline icons */
const P: Record<string, React.ReactNode> = {
  home:(<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>),
  grid:(<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>),
  mail:(<><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></>),
  login:(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/></>),
  check:(<path d="M20 6 9 17l-5-5"/>),
  menu:(<><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/></>),
  arrow:(<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>),
  tag:(<><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></>),
};
const Icon=({name,size=14}:{name:keyof typeof P;size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>
);

const tiers=[{name:'Starter',monthly:'29.50',annual:'234',equivalent:'19.50'},{name:'Growth',monthly:'64.50',annual:'474',equivalent:'39.50'},{name:'Scale',monthly:'214.50',annual:'1,554',equivalent:'129.50'}];
const NAV=[{label:'Home',href:'/',icon:'home' as const},{label:'Product',href:'/#workflow',icon:'grid' as const},{label:'Pricing',href:'/pricing',icon:'tag' as const,active:true},{label:'Contact',href:'/contact',icon:'mail' as const}];

export default function Pricing(){
  const[interval,setInterval]=useState<'month'|'year'>('month'),[selected,setSelected]=useState<string|null>(null),[menu,setMenu]=useState(false);
  const choice=tiers.find(t=>t.name===selected);
  return <DeskShell widget darkDefault><main className="ap-cx"><div className="ap-cx-frame"><div className="ap-cx-inner">
    <div className="ap-cx-navwrap">
      <nav className="ap-cx-nav" aria-label="Primary">
        <Link href="/" className="ap-cx-logo"><Image src="/automatepal-mark.svg" alt="" width={26} height={26}/>AutomatePal</Link>
        <div className="ap-cx-links">
          {NAV.map(n=><Link key={n.label} href={n.href} className={n.active?'ap-cx-active':undefined}><Icon name={n.icon} size={13}/>{n.label}</Link>)}
        </div>
        <Link href="/login" className="ap-cx-signin"><Icon name="login" size={13}/>Sign in</Link>
        <button className="ap-cx-burger" aria-label="Menu" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Icon name="menu" size={17}/></button>
      </nav>
      {menu&&<div className="ap-cx-menu">
        {NAV.map(n=><Link key={n.label} href={n.href} onClick={()=>setMenu(false)}><Icon name={n.icon} size={15}/>{n.label}</Link>)}
        <Link href="/login" onClick={()=>setMenu(false)}><Icon name="login" size={15}/>Sign in</Link>
      </div>}
    </div>

    <header className="ap-cx-hero">
      <span className="ap-cx-badge"><i/>Fictional PayPal sandbox configuration</span>
      <h1 className="ap-cx-h1"><span className="ap-cx-ln"><span>Sandbox demo</span></span> <span className="ap-cx-ln"><span><em>pricing.</em></span></span></h1>
      <p className="ap-cx-sub">Not a real commercial offer. No checkout, charges or subscriptions are available. Every plan starts with a fictional USD $1 three-day trial, followed by the selected recurring configuration below.</p>
      <div role="group" aria-label="Billing interval" className="ap-cx-toggle">
        <button type="button" aria-pressed={interval==='month'} onClick={()=>setInterval('month')}>Monthly {interval==='month'&&<Icon name="check" size={13}/>}</button>
        <button type="button" aria-pressed={interval==='year'} onClick={()=>setInterval('year')}>Annual {interval==='year'&&<Icon name="check" size={13}/>}</button>
      </div>
      <span className="ap-cx-trial-note">USD · fictional trial: $1 for 3 days</span>
    </header>

    <div className="ap-cx-tray">
      <section aria-label="Sandbox plan options" className="ap-cx-grid">
        {tiers.map(t=><article key={t.name} className={'ap-cx-card'+(selected===t.name?' ap-cx-selected':'')}>
          <h2 className="ap-cx-tier"><i/>{t.name}</h2>
          <p className="ap-cx-price">${interval==='month'?t.monthly:t.equivalent}<span> / month{interval==='year'?' equivalent':''}</span></p>
          <p className="ap-cx-line">{interval==='year'?`$${t.annual} billed yearly after the trial.`:`$${t.monthly} billed monthly after the trial.`}</p>
          <p className="ap-cx-note">{interval==='year'?'Annual total is charged once per year in this configuration, not monthly.':`Annual option: $${t.annual}/year ($${t.equivalent}/month equivalent).`}</p>
          <button type="button" aria-pressed={selected===t.name} aria-label={`Select ${t.name} sandbox plan`} onClick={()=>setSelected(t.name)} className="ap-cx-select">
            {selected===t.name?<><Icon name="check" size={14}/>Selected</>:<>Select {t.name}<Icon name="arrow" size={14}/></>}
          </button>
          <span className="ap-cx-note" style={{marginTop:8,textAlign:'center'}}>Demo only · no checkout</span>
          <div className="ap-cx-state">Sandbox plan state: CREATED, not subscribable. Tier names label test prices only. No different feature limits or customer entitlements are implemented by these plans.</div>
        </article>)}
        <article className="ap-cx-card ap-cx-gauge-card">
          <div>
            <h2 className="ap-cx-tier"><i/>How demo prices relate to the reference</h2>
            <p className="ap-cx-line" style={{marginTop:12}}>Demo figures are 50% of SiteGPT&apos;s publicly listed monthly and annual prices checked October 29, 2026. This is arithmetic only, not a feature, capacity, support or reliability comparison.</p>
          </div>
          <div className="ap-cx-gauge"><Gauge value={50} color="#FD91CC" label="Demo prices are 50 percent of the reference pricing, arithmetic only"/></div>
        </article>
      </section>

      <section role="status" aria-live="polite" aria-atomic="true" className="ap-cx-status">
        {choice?<><h2>{choice.name} / {interval==='year'?'annual':'monthly'} selected</h2>
          <p>Fictional $1 for 3 days, then ${interval==='year'?choice.annual:choice.monthly} per {interval==='year'?'year':'month'}. {interval==='year'?'The annual total is not billed monthly.':'Recurring monthly configuration.'}</p>
          <p className="ap-cx-note">Selection is local to this page and resets when reloaded. Nothing was saved, subscribed or charged. No feature entitlement changes.</p>
          <button type="button" className="ap-cx-clear" onClick={()=>setSelected(null)}>Clear selection</button></>
        :<p>Choose monthly or annual billing, then select a sandbox plan to preview its terms. No checkout will open.</p>}
      </section>
    </div>

    <section className="ap-cx-foot">
      <p>All six configurations share the same $1 three-day trial. No setup fee is configured. These records do not establish customer eligibility, tax, shipping, fees or a refund policy.</p>
      <p>The earlier $19 monthly test record and $12 demo records are retained separately, not offered in this table. Payment execution stays off.</p>
      <p><a className="underline" href="https://sitegpt.ai/pricing">Reference pricing ↗</a> · <Link className="underline" href="/sandbox-catalog">Owner-only live sandbox configuration reads ↗</Link></p>
    </section>
  </div></div></main></DeskShell>;
}
