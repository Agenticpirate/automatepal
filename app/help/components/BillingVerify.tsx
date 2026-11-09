"use client";
import {useState} from 'react';
import {widgetText, type WidgetText} from '../../../lib/widget-i18n';

export type BillingSupport = {
  providers: {provider: string; label: string; mode: 'test' | 'live'; capabilities: Record<string, boolean>; referenceHint: string}[];
  verified: {provider: string; label?: string; expiresAt: string} | null;
};

// Customer verification before any billing data is shown: order or invoice reference plus the
// email used to pay. The email is checked server-side and never stored.
export default function BillingVerify({token, support, onVerified, tx = widgetText('en')}: {token: string; support: BillingSupport; onVerified: (v: {provider: string; expiresAt: string}) => void; tx?: WidgetText}) {
  const [provider, setProvider] = useState(support.providers[0]?.provider ?? '');
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const chosen = support.providers.find((p) => p.provider === provider) ?? support.providers[0];
  if (support.verified) {
    const label = support.providers.find((p) => p.provider === support.verified!.provider)?.label ?? support.verified.label ?? 'Payment';
    return <p role="status" className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5">Verified for this chat for 30 minutes ({label}). Ask about this payment below. Read-only; no money moves.</p>;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/support', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'billing_verify', token, provider: chosen?.provider, reference, email})});
      const d = await r.json();
      if (r.ok && d.verified) { setReference(''); setEmail(''); onVerified({provider: d.provider, expiresAt: d.expiresAt}); }
      else setNote(d.error ?? 'Could not check that payment.');
    } catch { setNote('Could not check that payment.'); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} aria-label={tx.checkPayment} className="mb-4 space-y-3 rounded-lg border p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{tx.checkPayment}</h2>{chosen && <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${chosen.mode === 'live' ? 'bg-pink-100 text-pink-800' : 'bg-blue-50 text-blue-700'}`}>{chosen.mode === 'live' ? 'LIVE' : 'Test mode'}</span>}</div>
    <p className="text-xs leading-5 text-gray-500">{tx.checkPaymentHelp}</p>
    {support.providers.length > 1 && <label className="block text-xs">Paid with<select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border bg-white p-2">{support.providers.map((p) => <option key={p.provider} value={p.provider}>{p.label}</option>)}</select></label>}
    <label className="block text-xs">{tx.orderNumber}<input required minLength={3} maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" placeholder={chosen?.referenceHint} className="mt-1 block min-h-11 w-full rounded-lg border p-2"/></label>
    <label className="block text-xs">{tx.payEmail}<input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-1 block min-h-11 w-full rounded-lg border p-2"/></label>
    <button disabled={busy} className="min-h-11 w-full rounded-lg border p-2 text-sm disabled:opacity-50">{busy ? 'Checking...' : 'Check payment'}</button>
    {note && <p aria-live="polite" className="text-xs leading-5 text-gray-700">{note}</p>}
  </form>;
}
