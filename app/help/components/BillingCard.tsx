import type { BillingPreview } from '../../../lib/billing-preview';
export default function BillingCard({item}:{item:BillingPreview}) {
 return <section aria-label="Fictional billing overview" className="my-5 overflow-hidden rounded-xl border border-blue-100 bg-blue-50">
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 px-4 py-3"><h2 className="text-sm font-semibold">Billing overview</h2><span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-blue-700">Fictional fixture</span></div>
  <div className="p-4"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-gray-500">{item.reference} · Not a PayPal order ID</p><p className="mt-4 text-xs text-gray-500">Fixture total</p><p className="mt-1 text-3xl font-semibold tabular-nums">{item.currency} {(item.totalMinor/100).toFixed(2)}</p>
   <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 text-xs">{([['Payment',item.paymentStatus],['Refund',item.refundStatus],['Invoice',item.invoiceStatus],['Tax',item.taxStatus]] as const).map(([label,value])=><div key={label}><dt className="text-gray-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl>
   <p className="mt-5 border-t border-blue-100 pt-3 text-xs leading-5 text-gray-500">No real order, charge, refund or invoice exists here. A review request does not move money. Tax is not included or estimated in this fixture.</p>
  </div>
 </section>;
}
