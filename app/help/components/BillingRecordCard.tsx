import type {BillingCard} from '../../../lib/billing/core/types';
import {formatMoney} from '../../../lib/billing/core/money';

const KIND: Record<string, string> = {order: 'Order', charge: 'Charge', payment: 'Payment', invoice: 'Invoice', subscription: 'Subscription', refund: 'Refund', transaction: 'Transaction'};
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const httpsOnly = (u: string | null) => { try { return u && new URL(u).protocol === 'https:' ? u : null; } catch { return null; } };

// A read-only provider record shown as the source of a billing answer.
export default function BillingRecordCard({card}: {card: BillingCard}) {
  const live = card.mode === 'live';
  const amount = formatMoney(card.amountMinor, card.currency);
  const link = httpsOnly(card.hostedUrl);
  const rows: [string, string][] = [['Status', words(card.status)]];
  if (amount) rows.push(['Amount', amount]);
  if (card.createdAt) rows.push(['Date', day(card.createdAt)]);
  if (card.renewalAt) rows.push(['Renews', day(card.renewalAt)]);
  if (card.failure?.attemptCount) rows.push(['Failed attempts', String(card.failure.attemptCount)]);
  if (card.failure?.nextRetryAt) rows.push(['Next retry', day(card.failure.nextRetryAt)]);
  return <section aria-label="Billing record" className="mt-3 overflow-hidden rounded-xl border border-blue-100 bg-white text-gray-900">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 px-4 py-3">
      <h3 className="text-sm font-semibold">{card.providerLabel} · {KIND[card.kind] ?? card.kind}</h3>
      <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${live ? 'bg-pink-100 text-pink-800' : 'bg-blue-50 text-blue-700'}`}>{live ? 'LIVE' : 'Test mode'}</span>
    </div>
    <div className="p-4">
      <p className="break-all text-sm font-medium">{card.displayRef}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">{rows.map(([k, v]) => <div key={k}><dt className="text-gray-500">{k}</dt><dd className="mt-1 break-words font-medium">{v}</dd></div>)}</dl>
      {card.failure?.message && <p className="mt-3 text-xs leading-5 text-gray-700">Provider reason: {card.failure.message}</p>}
      {card.refunds.length > 0 && <ul aria-label="Refunds" className="mt-3 space-y-1 text-xs">{card.refunds.map((f) => <li key={f.id} className="flex flex-wrap justify-between gap-2"><span>Refund {words(f.status)}</span><span className="tabular-nums">{formatMoney(f.amountMinor, f.currency)}</span></li>)}</ul>}
      {link && <a href={link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-xs font-medium text-blue-700 underline">View hosted invoice</a>}
      <p className="mt-3 border-t border-blue-100 pt-3 text-xs leading-5 text-gray-500">Read-only. No money moves from this chat.</p>
    </div>
  </section>;
}
