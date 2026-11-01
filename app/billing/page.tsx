'use client';
import {useCallback, useEffect, useState} from 'react';
import Link from 'next/link';
import DeskShell from '../components/DeskShell';
import DashShell from '../components/DashShell';
import {authHeaders} from '../../lib/browser-auth';
import {formatMoney} from '../../lib/billing/core/money';
import './billing.css';

type Mode = 'test' | 'live';
type Provider = {id: string; label: string; tier: string; confidence: string; credentialFields: {name: string; label: string; secret: boolean; placeholder?: string}[]; configFields: {name: string; label: string; placeholder?: string; liveOnly?: boolean}[]; capabilities: Record<string, boolean>; referenceHint: string};
type Connection = {id: string; provider: string; mode: Mode; key_id: string; key_hint: string; status: string; last_checked_at: string | null; live_confirmed_at: string | null; created_at: string; needsRotation: boolean};
type Event = {id: string; provider: string; mode: Mode; event: string; created_at: string};
type Lookup = {id: string; case_id: string; provider: string; mode: Mode; kind: string; intent: string | null; outcome: string; record_kind: string | null; record_ref: string | null; record_status: string | null; amount_minor: number | null; currency: string | null; created_at: string};
type Data = {providers: Provider[]; connections: Connection[]; events: Event[]; lookups: Lookup[]; available: boolean; role: string; encryptionReady: boolean; paymentExecution: false; demo?: boolean; error?: string};

const CAPS: [string, string][] = [['order_status', 'Order status'], ['payment_history', 'Payment history'], ['failed_payment', 'Failed payment and retry'], ['invoice', 'Invoice link'], ['renewal', 'Renewal date'], ['refund_status', 'Refund status']];
const OUTCOME_TONE: Record<string, string> = {verified: 'ok', answered: 'ok', no_records: 'mut', unsupported: 'mut', mismatch: 'warn', not_found: 'warn', refused: 'warn', rate_limited: 'err', provider_error: 'err', circuit_open: 'err', pending: 'mut'};
const words = (s: string | null) => (s ?? '').replace(/_/g, ' ');
const when = (s: string | null) => (s ? new Date(s).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : 'Never');
const confidenceLabel = (c: string) => (c === 'docs-derived' ? 'Docs-derived contract' : c === 'official-spec-early-access' ? 'Early-access spec' : 'Official API spec');
function ModeBadge({mode}: {mode: Mode}) { return <span className={'bl-mode bl-mode-' + mode}>{mode === 'live' ? 'LIVE' : 'Test mode'}</span>; }

export default function Billing() {
  const [d, setD] = useState<Data | null>(null);
  const [status, setStatus] = useState<{text: string; error?: boolean}>({text: ''});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{provider: string; mode: Mode} | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [phrase, setPhrase] = useState('');
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/billing', {headers: await authHeaders()});
      const j = await r.json();
      if (!r.ok) throw Error(j.error ?? 'Billing view unavailable.');
      setD(j);
    } catch (e) { setStatus({text: e instanceof Error ? e.message : 'Billing view unavailable.', error: true}); }
  }, []);
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load]);

  const canManage = !!d && !d.demo && (d.role === 'owner' || d.role === 'admin');
  const isOwner = d?.role === 'owner';
  const chosen = d?.providers.find((p) => p.id === form?.provider);
  const livePhrase = chosen ? 'CONNECT LIVE ' + chosen.id.toUpperCase() : '';

  async function act(body: Record<string, unknown>) {
    setBusy(true); setStatus({text: ''});
    try {
      const r = await fetch('/api/billing', {method: 'POST', headers: {'Content-Type': 'application/json', ...await authHeaders()}, body: JSON.stringify(body)});
      const j = await r.json().catch(() => ({}));
      setStatus(r.ok ? {text: [j.note, j.warning].filter(Boolean).join(' ') || 'Done.'} : {text: j.error ?? 'Request failed.', error: true});
      if (r.ok) await load();
      return r.ok;
    } catch { setStatus({text: 'Request failed. Try again.', error: true}); return false; } finally { setBusy(false); }
  }
  function openForm(provider: string) { setForm({provider, mode: 'test'}); setValues({}); setStep('details'); setPhrase(''); }
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen || !form) return;
    if (form.mode === 'live' && step === 'details') { setStep('confirm'); return; }
    const credentials = Object.fromEntries(chosen.credentialFields.map((f) => [f.name, values[f.name] ?? '']));
    const config = Object.fromEntries(chosen.configFields.map((f) => [f.name, values['config.' + f.name] ?? '']).filter(([, v]) => v));
    await act({action: 'connect', provider: chosen.id, mode: form.mode, credentials, config, ...(form.mode === 'live' ? {confirmLive: phrase} : {})});
    // Secrets never stay in the browser after a save attempt.
    setValues({}); setPhrase(''); setStep('details');
  }

  const failures = d?.lookups.filter((l) => ['provider_error', 'rate_limited', 'circuit_open'].includes(l.outcome)).length ?? 0;
  const kpis: [string, string | number, string][] = d ? [
    ['Connections', d.connections.length, `${d.providers.length} provider${d.providers.length === 1 ? '' : 's'} available`],
    ['Lookups loaded', d.lookups.length, 'Latest 100, metadata only'],
    ['Verified chats', d.lookups.filter((l) => l.outcome === 'verified').length, 'Order or invoice + payment email'],
    ['Provider failures', failures, 'Errors, rate limits, breaker'],
  ] : [];

  return <DeskShell widget><DashShell crumb="Billing">
    <div className="bl">
      <div className="ap-dash-headrow">
        <div>
          <p className="ap-dash-kicker">Workspace · Billing</p>
          <h1 className="ap-dash-h1"><span className="ap-dash-ln"><span>Billing support</span></span></h1>
          <p className="ap-dash-sub">Connect a payment provider with a read-only key so the assistant can answer order, invoice, renewal and refund questions for verified customers. Read-only. No money moves. Refunds are recorded for review, never executed.</p>
        </div>
      </div>
      {status.text && <p role="status" className={status.error ? 'ap-dash-note-warn' : 'ap-dash-note-ok'}>{status.text}</p>}
      {d && !d.encryptionReady && <p className="ap-dash-note-warn">Set BILLING_ENCRYPTION_KEYS, BILLING_ENCRYPTION_ACTIVE_KID and BILLING_RPC_SECRET on the server before connecting a provider.</p>}
      {d && !d.available && <p className="ap-dash-note-warn">Billing tables are not in this database yet. Apply migration 044 (locally first) to connect a provider.</p>}
      {d?.demo && <p className="ap-dash-note-warn">Fictional demo data. Sign in to connect a provider.</p>}
      {!d && !status.error && <div className="ap-dash-card"><p className="ap-dash-muted">Loading billing…</p></div>}
      {d && <>
        <div className="ap-dash-kpis">{kpis.map(([h, v, c]) => <div key={h} className="ap-dash-kpi"><h3>{h}</h3><p>{v}</p><span className="ap-dash-chip">{c}</span></div>)}</div>

        <section className="ap-dash-card" aria-labelledby="bl-conns">
          <h2 id="bl-conns" className="ap-dash-h2">Connections</h2>
          {d.connections.length === 0 && <p className="ap-dash-muted">No provider connected. Customers see the published-knowledge answers only.</p>}
          <ul className="bl-conns">{d.connections.map((c, i) => {
            const p = d.providers.find((x) => x.id === c.provider);
            return <li key={c.id} className="bl-conn" style={{'--i': i} as React.CSSProperties}>
              <div className="bl-conn-main"><strong>{p?.label ?? c.provider}</strong><ModeBadge mode={c.mode}/><span className={'bl-chip bl-chip-' + (c.status === 'connected' ? 'ok' : 'err')}>{c.status === 'connected' ? 'Connected' : 'Check failed'}</span>{c.needsRotation && <span className="bl-chip bl-chip-warn">Needs rotation</span>}</div>
              <p className="bl-conn-meta">Key {c.key_hint || 'hidden'} · key id {c.key_id} · last checked {when(c.last_checked_at)}{c.live_confirmed_at ? ` · LIVE confirmed ${when(c.live_confirmed_at)}` : ''}</p>
              {canManage && <div className="bl-actions">
                <button type="button" className="bl-btn" disabled={busy} onClick={() => void act({action: 'test', provider: c.provider})}>Test</button>
                <button type="button" className="bl-btn" disabled={busy} onClick={() => void act({action: 'rotate', provider: c.provider})}>Rotate</button>
                <button type="button" className="bl-btn bl-btn-danger" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${p?.label ?? c.provider}? The stored key is deleted.`)) void act({action: 'disconnect', provider: c.provider}); }}>Disconnect</button>
              </div>}
            </li>;
          })}</ul>
        </section>

        <section className="ap-dash-card" aria-labelledby="bl-providers">
          <h2 id="bl-providers" className="ap-dash-h2">Payment providers</h2>
          <p className="ap-dash-muted">Only providers with a tested read-only adapter are listed. Each one shows the lookups its read API supports; the assistant never claims the rest.</p>
          <ul className="bl-grid">{d.providers.map((p, i) => <li key={p.id} className="bl-provider" style={{'--i': i} as React.CSSProperties}>
            <div className="bl-provider-head"><strong>{p.label}</strong><span className="bl-chip bl-chip-mut">{confidenceLabel(p.confidence)}</span></div>
            <ul className="bl-caps" aria-label={`${p.label} lookups`}>{CAPS.map(([k, label]) => <li key={k} className={p.capabilities[k] ? 'bl-cap-yes' : 'bl-cap-no'}>{label}{p.capabilities[k] ? '' : ' (not offered)'}</li>)}</ul>
            {canManage && <button type="button" className="bl-btn" disabled={busy} onClick={() => openForm(p.id)}>{d.connections.some((c) => c.provider === p.id) ? 'Replace key' : 'Connect'}</button>}
          </li>)}</ul>
        </section>

        {form && chosen && canManage && <section className="ap-dash-card" aria-labelledby="bl-connect">
          <h2 id="bl-connect" className="ap-dash-h2">Connect {chosen.label}</h2>
          <form className="bl-form" onSubmit={connect} autoComplete="off">
            {step === 'details' && <>
              <fieldset className="bl-modes"><legend>Mode</legend>
                {(['test', 'live'] as Mode[]).map((m) => <label key={m} className="bl-radio"><input type="radio" name="bl-mode" value={m} checked={form.mode === m} disabled={m === 'live' && !isOwner} onChange={() => setForm({...form, mode: m})}/>{m === 'live' ? 'LIVE' : 'Test mode'}</label>)}
              </fieldset>
              {!isOwner && <p className="ap-dash-muted">Only the workspace owner can connect LIVE mode.</p>}
              {chosen.credentialFields.map((f) => <label key={f.name} className="ap-dash-field">{f.label}<input className="bl-input" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} required value={values[f.name] ?? ''} placeholder={f.placeholder} onChange={(e) => setValues({...values, [f.name]: e.target.value})}/></label>)}
              {chosen.configFields.filter((f) => !f.liveOnly || form.mode === 'live').map((f) => <label key={f.name} className="ap-dash-field">{f.label}<input className="bl-input" type="text" autoComplete="off" value={values['config.' + f.name] ?? ''} placeholder={f.placeholder} onChange={(e) => setValues({...values, ['config.' + f.name]: e.target.value})}/></label>)}
              <p className="ap-dash-muted">Use a read-only or restricted key. The key is encrypted on the server, never shown again and never logged. AutomatePal only calls the read endpoints this adapter allows.</p>
              <div className="bl-actions"><button className="ap-dash-btn" disabled={busy}>{form.mode === 'live' ? 'Continue to LIVE confirmation' : 'Check and connect'}</button><button type="button" className="bl-btn" onClick={() => { setForm(null); setValues({}); }}>Cancel</button></div>
            </>}
            {step === 'confirm' && <>
              <p className="ap-dash-note-warn">LIVE mode reads real customer payments. Verified customers will see their own real order, invoice and refund status. Nothing is charged or refunded from AutomatePal.</p>
              <label className="ap-dash-field">Type {livePhrase} to confirm<input className="bl-input" aria-label="Live confirmation phrase" autoComplete="off" spellCheck={false} value={phrase} onChange={(e) => setPhrase(e.target.value)}/></label>
              <div className="bl-actions"><button className="ap-dash-btn" disabled={busy || phrase !== livePhrase}>Connect LIVE</button><button type="button" className="bl-btn" onClick={() => setStep('details')}>Back</button></div>
            </>}
          </form>
        </section>}

        <div className="bl-two">
          <section className="ap-dash-card" aria-labelledby="bl-lookups">
            <h2 id="bl-lookups" className="ap-dash-h2">Recent lookups</h2>
            {d.lookups.length === 0 ? <p className="ap-dash-muted">No customer lookups yet.</p> : <div className="bl-table-wrap"><table className="bl-table">
              <thead><tr><th scope="col">When</th><th scope="col">Provider</th><th scope="col">Lookup</th><th scope="col">Outcome</th><th scope="col">Record</th><th scope="col">Ticket</th></tr></thead>
              <tbody>{d.lookups.map((l) => <tr key={l.id}>
                <td>{when(l.created_at)}</td>
                <td>{d.providers.find((p) => p.id === l.provider)?.label ?? l.provider} <ModeBadge mode={l.mode}/></td>
                <td>{l.kind === 'verify' ? 'Verification' : words(l.intent)}</td>
                <td><span className={'bl-chip bl-chip-' + (OUTCOME_TONE[l.outcome] ?? 'mut')}>{words(l.outcome)}</span></td>
                <td>{[l.record_kind, l.record_ref, words(l.record_status).toLowerCase(), formatMoney(l.amount_minor, l.currency)].filter(Boolean).join(' · ') || '—'}</td>
                <td><Link href={`/tickets?ticket=${l.case_id}`} className="bl-link">Open ticket</Link></td>
              </tr>)}</tbody>
            </table></div>}
          </section>
          <section className="ap-dash-card" aria-labelledby="bl-events">
            <h2 id="bl-events" className="ap-dash-h2">Connection history</h2>
            {d.events.length === 0 ? <p className="ap-dash-muted">No connection changes yet.</p> : <ol className="bl-events">{d.events.map((e) => <li key={e.id}><span>{d.providers.find((p) => p.id === e.provider)?.label ?? e.provider} · {words(e.event)}</span><ModeBadge mode={e.mode}/><time dateTime={e.created_at}>{when(e.created_at)}</time></li>)}</ol>}
          </section>
        </div>
      </>}
    </div>
  </DashShell></DeskShell>;
}
