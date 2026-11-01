import type {BillingIntent} from './types';

// Ordered keyword rules. A billing intent needs the visitor to refer to their own payment
// ("my", "I", "me", "we", "our"), so pre-sales questions such as "Do you accept card payments?"
// or "What is your refund policy?" stay with the published-knowledge answer flow.
const SELF = /\b(my|mine|i|i'm|i've|me|we|our|us)\b/i;
const RULES: [BillingIntent, RegExp][] = [
  ['refund_status', /\brefund/i],
  ['failed_payment', /\b(fail(ed|ing|ure)?|declin(e|ed|ing)|retry|retried|bounced|did ?n[o']?t go through|unsuccessful)/i],
  ['invoice', /\b(invoice|receipt)/i],
  ['renewal', /\b(renew(s|al|ed)?|next (billing|bill|payment|charge)|subscription)/i],
  ['payment_history', /\b(history|past payments?|previous payments?|all (of )?(my )?payments|transactions?|payments (have|did) (i|we) make)/i],
  ['order_status', /\b((my|our) (last |latest |recent )?(order|charge|payment|purchase)|order (status|number)|status of (my|our)|charged|(have|did) (i|we) pay|(i|we) (have )?paid)\b/i],
];

export function billingIntent(question: string): BillingIntent | null {
  const q = String(question ?? '').slice(0, 500);
  if (!SELF.test(q)) return null;
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return null;
}

export const INTENT_LABELS: Record<BillingIntent, string> = {
  order_status: 'Order or payment status',
  payment_history: 'Payment history',
  failed_payment: 'Failed payment and retry',
  invoice: 'Invoice',
  renewal: 'Subscription renewal',
  refund_status: 'Refund status',
};
// Quick-button questions in the widget; each classifies to its own intent.
export const INTENT_QUESTIONS: Record<BillingIntent, string> = {
  order_status: 'What is the status of my order?',
  payment_history: 'Show my payment history.',
  failed_payment: 'Why did my payment fail, and will it retry?',
  invoice: 'Can I see my invoice?',
  renewal: 'When does my subscription renew?',
  refund_status: 'What is the status of my refund?',
};
