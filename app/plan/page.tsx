'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import DeskShell from '../components/DeskShell';
import DashShell from '../components/DashShell';
import {authHeaders} from '../../lib/browser-auth';
/* Plan: the workspace's AutomatePal plan, usage this month and checkout. Subscriptions run on PayPal
   (sandbox until live credentials are configured); the server re-reads every subscription from PayPal
   before it changes the plan (app/api/billing/plan, app/api/paypal/webhook). Only the workspace owner can
   subscribe, switch or cancel; everyone else sees the plan and usage. */
type Limits = {plan: string; messages: number; pages: number; sources: number; seats: number; bots: number; refresh: string; features: string[]};
type CatalogItem = Limits & {key: 'starter' | 'growth' | 'scale'; name: string; price: {month: number; year: number}};
type Data = {
  plan: string; role: string; canManage: boolean; workspace: string; limits: Limits; monthStart: string;
  usage: {messages: number; sources: number; pages: number; seats: number};
  subscription: null | {provider: 'paypal' | 'manual'; plan: string; interval: 'month' | 'year' | null; status: string; periodEnd: string | null; graceUntil: string | null};
  checkout: null | {clientId: string; sandbox: boolean; planIds: Record<string, string>};
  catalog: CatalogItem[]; free: Limits; trial: {days: number; price: number};
};
type PayPalButtons = {render(el: HTMLElement): Promise<void>; close?: () => void};
type PayPalSdk = {Buttons(o: {style?: object; createSubscription(d: unknown, a: {subscription: {create(o: object): Promise<string>}}): Promise<string>; onApprove(d: {subscriptionID?: string}): Promise<void>; onError(e: unknown): void; onCancel?(): void}): PayPalButtons};
const FEATURE_NAMES: Record<string, string> = {api: 'API access', webhooks: 'Webhooks', mcp: 'MCP server', billing_support: 'Billing support for your customers', insights: 'AI conversation insights', scheduled_refresh: 'Scheduled website refresh'};
const money = (n: number) => '$' + (Number.isInteger(n) ? n.toString() : n.toFixed(2));
const day = (s: string | null) => s ? new Date(s).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : '';
const num = (n: number) => n.toLocaleString('en-US');
function Meter({label, used, limit}: {label: string; used: number; limit: number}) {
  const pct = Math.min(100, Math.round(used / Math.max(limit, 1) * 100));
  return <div style={{minWidth: 180, flex: '1 1 180px'}}><div style={{display: 'flex', justifyContent: 'space-between', fontSize: 12}}><span>{label}</span><span className="ap-dash-muted">{num(used)} / {num(limit)}</span></div>
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} style={{height: 8, borderRadius: 4, background: '#E8ECF6', marginTop: 6, overflow: 'hidden'}}><div style={{width: pct + '%', height: '100%', background: pct >= 90 ? '#B91C1C' : '#233de8'}}/></div></div>;
}
let sdkPromise: Promise<PayPalSdk> | null = null;
function loadPayPal(clientId: string): Promise<PayPalSdk> {
  const w = window as unknown as {paypal?: PayPalSdk};
  if (w.paypal) return Promise.resolve(w.paypal);
  sdkPromise ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&components=buttons&currency=USD`;
    s.async = true; s.onload = () => w.paypal ? ok(w.paypal) : fail(Error('PayPal did not load')); s.onerror = () => { sdkPromise = null; fail(Error('PayPal did not load')); };
    document.head.append(s);
  });
  return sdkPromise;
}
export default function Plan() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [interval, setInterval_] = useState<'month' | 'year'>('month'), [choosing, setChoosing] = useState<string | null>(null);
  const buttonsEl = useRef<HTMLDivElement>(null), rendered = useRef<PayPalButtons | null>(null);
  const load = useCallback(async () => { const r = await fetch('/api/billing/plan', {headers: await authHeaders()}); const d = await r.json(); if (!r.ok) { setError(d.error ?? 'Could not load your plan.'); return; } setError(''); setData(d); }, []);
  const post = useCallback(async (body: object) => {
    setBusy(true);
    try { const r = await fetch('/api/billing/plan', {method: 'POST', headers: {'Content-Type': 'application/json', ...await authHeaders()}, body: JSON.stringify(body)}); const d = await r.json(); if (!r.ok) throw Error(d.error); if (d.note) setNotice(d.note); return d; }
    catch (e) { setNotice(e instanceof Error ? e.message : 'That did not work. Try again.'); return null; }
    finally { setBusy(false); }
  }, []);
  // Back from approving a plan change in PayPal: re-read the subscription once.
  const returned = useRef(false);
  useEffect(() => {
    authHeaders().then(h => fetch('/api/billing/plan', {headers: h})).then(async r => { const d = await r.json(); if (!r.ok) setError(d.error ?? 'Could not load your plan.'); else setData(d); }).catch(() => setError('Could not load your plan.'));
    const q = new URLSearchParams(location.search);
    if (!returned.current && q.get('changed') === '1') { returned.current = true; history.replaceState(null, '', '/plan'); void post({action: 'refresh'}).then(() => load()); }
    // From the pricing page: /plan?choose=growth&interval=year preselects that plan.
    const choose = q.get('choose'), iv = q.get('interval');
    if (choose && ['starter', 'growth', 'scale'].includes(choose)) { history.replaceState(null, '', '/plan'); void Promise.resolve().then(() => { setChoosing(choose); if (iv === 'year' || iv === 'month') setInterval_(iv); }); }
  }, [load, post]);
  // PayPal subscribe buttons for the plan being chosen.
  useEffect(() => {
    if (!choosing || !data?.checkout || !buttonsEl.current) return;
    const planId = data.checkout.planIds[`${choosing}_${interval}`], el = buttonsEl.current, ws = data.workspace;
    let cancelled = false;
    el.textContent = 'Loading PayPal…';
    loadPayPal(data.checkout.clientId).then(paypal => {
      if (cancelled) return;
      el.textContent = '';
      const b = paypal.Buttons({
        style: {layout: 'vertical', label: 'subscribe', shape: 'rect'},
        createSubscription: (_d, actions) => actions.subscription.create({plan_id: planId, custom_id: ws, application_context: {shipping_preference: 'NO_SHIPPING', brand_name: 'AutomatePal'}}),
        onApprove: async d => { if (d.subscriptionID) { const r = await post({action: 'activate', subscriptionId: d.subscriptionID}); if (r) { setChoosing(null); await load(); } } },
        onError: () => setNotice('PayPal could not start the subscription. Nothing was charged; try again.'),
        onCancel: () => setNotice('Checkout cancelled. Nothing was charged.'),
      });
      rendered.current = b;
      return b.render(el);
    }).catch(() => { if (!cancelled) el.textContent = 'PayPal could not load. Check your connection or ad blocker and try again.'; });
    return () => { cancelled = true; try { rendered.current?.close?.(); } catch { /* already gone */ } rendered.current = null; el.textContent = ''; };
  }, [choosing, interval, data?.checkout, data?.workspace, load, post]);
  async function change(plan: string) { const d = await post({action: 'change', plan, interval}); if (d?.approveUrl) location.assign(d.approveUrl); }
  async function cancel() { if (!confirm('Cancel your subscription? You keep your plan until the end of the period you paid for.')) return; if (await post({action: 'cancel'})) await load(); }
  const sub = data?.subscription, paypalLive = sub?.provider === 'paypal' && (sub.status === 'active' || sub.status === 'suspended');
  const current = data?.catalog.find(c => c.key === data.plan);
  return <DeskShell widget><DashShell crumb="Plan"><main style={{display: 'contents'}}>
    <header>
      <p className="ap-dash-kicker">Workspace / plan</p>
      <h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Plan and usage</span></span></h1>
      <p className="ap-dash-sub">Your plan sets how many AI answers, pages of knowledge and team seats the workspace has each month. Payments run through PayPal{data?.checkout?.sandbox ? ' (sandbox: test accounts only, no real money)' : ''}.</p>
    </header>
    {error && <section className="ap-dash-card" role="alert"><p className="ap-dash-muted" style={{margin: 0}}>{error}</p></section>}
    {notice && <p className="ap-dash-note-ok" role="status">{notice}</p>}
    {data && <>
      <section className="ap-dash-card" aria-labelledby="plan-now">
        <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'baseline'}}>
          <h2 id="plan-now" className="ap-dash-h2" style={{margin: 0}}>{(current?.name ?? (data.plan === 'enterprise' ? 'Enterprise' : 'Free'))} plan</h2>
          <span className="ap-dash-muted">{sub?.provider === 'manual' ? 'Set by AutomatePal' : sub ? `${sub.status === 'active' ? 'Renews' : sub.status === 'cancelled' ? 'Ends' : 'Period ends'} ${day(sub.periodEnd)}${sub.interval ? ` · billed ${sub.interval === 'year' ? 'yearly' : 'monthly'}` : ''}` : 'No subscription'}</span>
        </div>
        {sub?.status === 'suspended' && <p className="ap-dash-note-warn">PayPal could not collect the last payment. Your plan stays active until {day(sub.graceUntil)}; update your payment method in PayPal.</p>}
        {sub?.status === 'cancelled' && data.plan !== 'free' && <p className="ap-dash-note-warn">Cancelled. You keep these limits until {day(sub.periodEnd)}, then move to Free. Nothing is deleted.</p>}
        <div style={{display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 14}}>
          <Meter label={`AI answers since ${day(data.monthStart)}`} used={data.usage.messages} limit={data.limits.messages}/>
          <Meter label="Knowledge pages" used={data.usage.pages} limit={data.limits.pages}/>
          <Meter label="Sources" used={data.usage.sources} limit={data.limits.sources}/>
          <Meter label="Seats (incl. open invites)" used={data.usage.seats} limit={data.limits.seats}/>
        </div>
        <p className="ap-dash-muted" style={{margin: '12px 0 0'}}>A page is 2,500 characters of source text. When AI answers run out, visitors can still ask for a person.</p>
        {data.canManage && paypalLive && sub?.status !== 'cancelled' && <button type="button" disabled={busy} onClick={cancel} className="ap-dash-btn ap-dash-btn-ghost" style={{marginTop: 12}}>Cancel subscription</button>}
      </section>
      <section className="ap-dash-card" aria-labelledby="plan-choose">
        <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center'}}>
          <h2 id="plan-choose" className="ap-dash-h2" style={{margin: 0}}>{paypalLive ? 'Change plan' : 'Choose a plan'}</h2>
          <div role="radiogroup" aria-label="Billing interval" style={{display: 'flex', gap: 6}}>
            {(['month', 'year'] as const).map(i => <button key={i} type="button" role="radio" aria-checked={interval === i} onClick={() => setInterval_(i)} className={'ap-dash-btn ap-dash-btn-ghost' + (interval === i ? ' ap-dash-platform-active' : '')} style={{padding: '6px 12px', fontSize: 12}}>{i === 'month' ? 'Monthly' : 'Yearly (save up to 40%)'}</button>)}
          </div>
        </div>
        {!data.canManage && <p className="ap-dash-muted">Only the workspace owner can change the plan.</p>}
        {data.canManage && !data.checkout && <p className="ap-dash-note-warn">Checkout is not configured on this server yet.</p>}
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, marginTop: 14}}>
          {data.catalog.map(p => {
            const isCurrent = paypalLive && sub?.plan === p.key && sub?.interval === interval;
            return <div key={p.key} className="ap-dash-card" style={{boxShadow: 'none', margin: 0, borderColor: isCurrent ? '#233de8' : undefined}}>
              <h3 className="ap-dash-h2" style={{fontSize: 16, margin: 0}}>{p.name}</h3>
              <p style={{margin: '6px 0 0', fontSize: 22, fontWeight: 650}}>{money(interval === 'month' ? p.price.month : p.price.year / 12)}<span className="ap-dash-muted" style={{fontSize: 12, fontWeight: 400}}> /month{interval === 'year' ? `, ${money(p.price.year)} billed yearly` : ''}</span></p>
              <p className="ap-dash-muted" style={{margin: '4px 0 0', fontSize: 12}}>{money(data.trial.price)} for the first {data.trial.days} days</p>
              <ul style={{margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.8}}>
                <li>{num(p.messages)} AI answers a month</li><li>{num(p.pages)} pages of knowledge</li><li>{p.seats} {p.seats === 1 ? 'seat' : 'seats'}</li>
                {p.refresh !== 'manual' && <li>Automatic {p.refresh} website refresh</li>}
                {p.features.filter(f => f !== 'scheduled_refresh').map(f => <li key={f}>{FEATURE_NAMES[f] ?? f}</li>)}
              </ul>
              {data.canManage && data.checkout && (isCurrent ? <p className="ap-dash-note-ok" style={{marginTop: 10}}>Your current plan</p>
                : paypalLive ? <button type="button" disabled={busy} onClick={() => change(p.key)} className="ap-dash-btn" style={{marginTop: 10}}>Switch to {p.name}</button>
                : <button type="button" disabled={busy} onClick={() => setChoosing(p.key)} className="ap-dash-btn" style={{marginTop: 10}}>{choosing === p.key ? 'Selected' : `Start ${p.name}`}</button>)}
            </div>;
          })}
        </div>
        {choosing && !paypalLive && <div style={{marginTop: 16, maxWidth: 420}}>
          <p className="ap-dash-muted" style={{margin: '0 0 8px'}}>Subscribe to {data.catalog.find(c => c.key === choosing)?.name}, billed {interval === 'month' ? 'monthly' : 'yearly'}. Cancel any time.</p>
          <div ref={buttonsEl} aria-live="polite"/>
        </div>}
        <p className="ap-dash-muted" style={{margin: '14px 0 0'}}>Free: {num(data.free.messages)} AI answers a month, {num(data.free.pages)} pages, 1 seat. Need more? Enterprise plans are set up with us directly.</p>
      </section>
    </>}
  </main></DashShell></DeskShell>;
}
