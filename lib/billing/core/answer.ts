import {formatMoney} from './money';
import {redact, redactId} from './redact';
import {toCard} from './scope';
import type {BillingCard, BillingIntent, BillingMode, BillingRecord, ProviderDefinition} from './types';

// Deterministic templates; no model call. Each record is the answer's source and a card.
export type BillingSource = {id: string; title: string; sourceKind: 'billing_record'; quotes: string[]};
export type BillingAnswer = {answer: string; supported: boolean; sources: BillingSource[]; cards: BillingCard[]};

const KIND: Record<string, string> = {order: 'order', charge: 'charge', payment: 'payment', invoice: 'invoice', subscription: 'subscription', refund: 'refund', transaction: 'transaction'};
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
export const unsupportedSentence = (label: string) => `${label} doesn't offer that lookup through its read API.`;
export const modeFooter = (mode: BillingMode) => `Read-only ${mode === 'live' ? 'LIVE' : 'Test mode'} record. No money moved.`;

function line(r: BillingRecord): string {
  const amount = formatMoney(r.amountMinor, r.currency);
  return `${KIND[r.kind] ?? r.kind} ${r.displayRef} is ${r.status.toLowerCase().replace(/_/g, ' ')}${amount ? ` (${amount})` : ''}`;
}

function sentences(intent: BillingIntent, records: BillingRecord[]): string[] {
  const first = records[0];
  switch (intent) {
    case 'order_status':
      return [`Your ${line(first)}.`, ...(records.length > 1 ? [`${records.length - 1} related record${records.length > 2 ? 's are' : ' is'} listed below.`] : [])];
    case 'payment_history': {
      const shown = records.slice(0, 3).map(line).join('; ');
      return [`I found ${records.length} payment record${records.length === 1 ? '' : 's'} for your verified reference.`, `Most recent: ${shown}.`];
    }
    case 'failed_payment': {
      const f = records.find((r) => r.failure) ?? first;
      const out = [`Your ${line(f)}.`];
      if (f.failure?.message) out.push(`The provider reports: ${redact(f.failure.message).replace(/[.\s]+$/, '')}.`);
      if (f.failure?.nextRetryAt) out.push(`The next automatic attempt is scheduled for ${day(f.failure.nextRetryAt)}${f.failure.attemptCount ? ` after ${f.failure.attemptCount} attempt${f.failure.attemptCount === 1 ? '' : 's'}` : ''}.`);
      else if (f.failure?.attemptCount) out.push(`${f.failure.attemptCount} failed attempt${f.failure.attemptCount === 1 ? '' : 's'} recorded; no retry is scheduled.`);
      return out;
    }
    case 'invoice': {
      const inv = records.find((r) => r.kind === 'invoice') ?? first;
      return [`Your ${line(inv)}.`, inv.hostedUrl ? 'The hosted invoice link is on the card below.' : 'This provider did not return a hosted invoice link for it.'];
    }
    case 'renewal': {
      const sub = records.find((r) => r.renewalAt) ?? first;
      return [sub.renewalAt ? `Your ${line(sub)} and renews on ${day(sub.renewalAt)}.` : `Your ${line(sub)}; no upcoming renewal date is set.`];
    }
    case 'refund_status': {
      const refunds = records.flatMap((r) => r.refunds.map((f) => ({...f, parent: r.displayRef})));
      const own = records.filter((r) => r.kind === 'refund' || (!r.refunds.length && /REFUND/i.test(r.status)));
      const all = [...refunds.map((f) => `refund ${redactId(f.id)} on ${f.parent} is ${f.status.toLowerCase()}${formatMoney(f.amountMinor, f.currency) ? ` (${formatMoney(f.amountMinor, f.currency)})` : ''}`), ...own.map(line)];
      return [all.length ? `Your ${all.slice(0, 3).join('; ')}.` : `No refund is recorded on your ${line(first)}.`, 'No refund has been issued by this assistant.'];
    }
  }
}

export function composeBillingAnswer(definition: Pick<ProviderDefinition, 'label' | 'capabilities' | 'hostedHosts' | 'id'>, intent: BillingIntent, records: BillingRecord[], mode: BillingMode): BillingAnswer {
  const footer = modeFooter(mode);
  if (!definition.capabilities[intent]?.supported) return {answer: `${unsupportedSentence(definition.label)} ${footer}`, supported: false, sources: [], cards: []};
  if (!records.length) {
    const extra = intent === 'refund_status' ? ' No refund has been issued by this assistant.' : '';
    return {answer: `I couldn't find a matching record for that question on your verified payment.${extra} ${footer}`, supported: false, sources: [], cards: []};
  }
  const shown = records.slice(0, 5);
  const cards = shown.map((r) => toCard(definition, r));
  const sources: BillingSource[] = cards.map((c) => ({
    id: `billing:${definition.id}:${c.kind}:${c.id}`,
    title: `${definition.label} ${KIND[c.kind] ?? c.kind} ${c.displayRef}`,
    sourceKind: 'billing_record',
    quotes: [`Status: ${c.status}`, ...(formatMoney(c.amountMinor, c.currency) ? [`Amount: ${formatMoney(c.amountMinor, c.currency)}`] : []), ...(c.renewalAt ? [`Renews: ${day(c.renewalAt)}`] : [])],
  }));
  return {answer: [...sentences(intent, shown), footer].join(' '), supported: true, sources, cards};
}
