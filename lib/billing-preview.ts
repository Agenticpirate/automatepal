import { z } from 'zod';

// A display-only fixture. Never turn this into payment/order lookup evidence.
const fixture = z.object({
  id: z.string().uuid(), fictional: z.literal(true),
  order: z.string().min(1).max(160),
  amount: z.number().finite().nonnegative().max(100000),
  currency: z.literal('USD'),
});
export type BillingPreview = {
  mode: 'fictional'; reference: string; title: string;
  totalMinor: number; currency: 'USD';
  paymentStatus: 'Not connected'; refundStatus: 'Review only';
  invoiceStatus: 'Not issued'; taxStatus: 'Not calculated';
};
export function billingPreview(value: unknown): BillingPreview | null {
  const parsed = fixture.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {mode:'fictional',reference:`DEMO-${v.id.slice(0,8).toUpperCase()}`,
    title:v.order,totalMinor:Math.round(v.amount*100),currency:v.currency,
    paymentStatus:'Not connected',refundStatus:'Review only',
    invoiceStatus:'Not issued',taxStatus:'Not calculated'};
}
