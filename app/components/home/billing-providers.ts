/* Payment providers the public site may name. Mirrors the `enabled:true` entries of
   lib/billing/core/registry.ts and their capability matrices (that module pulls in every adapter, so the
   client home page does not import it). scripts/verify-site-refresh.mjs fails if this list and the
   registry disagree, or if the home page names a provider the registry does not enable. */
export type SiteCapability='order_status'|'payment_history'|'failed_payment'|'invoice'|'renewal'|'refund_status';
export type SiteProvider={id:string;label:string;confidence:'official-spec'|'official-spec-early-access'|'docs-derived';missing:SiteCapability[]};
export const SITE_BILLING_PROVIDERS:SiteProvider[]=[
 {id:'paypal',label:'PayPal',confidence:'official-spec',missing:[]},
 {id:'stripe',label:'Stripe',confidence:'official-spec',missing:[]},
 {id:'dodo',label:'Dodo Payments',confidence:'official-spec',missing:[]},
 {id:'razorpay',label:'Razorpay',confidence:'docs-derived',missing:[]},
 {id:'paddle',label:'Paddle',confidence:'official-spec',missing:[]},
 {id:'square',label:'Square',confidence:'official-spec',missing:[]},
 {id:'adyen',label:'Adyen',confidence:'official-spec',missing:['payment_history','failed_payment','renewal','refund_status']},
 {id:'mollie',label:'Mollie',confidence:'official-spec',missing:['invoice']},
 {id:'chargebee',label:'Chargebee',confidence:'official-spec-early-access',missing:[]},
 {id:'lemonsqueezy',label:'Lemon Squeezy',confidence:'docs-derived',missing:[]},
];
export const PROVIDER_LABELS=SITE_BILLING_PROVIDERS.map(p=>p.label);
/* "PayPal, Stripe, … and Lemon Squeezy" */
export const providerSentence=()=>PROVIDER_LABELS.slice(0,-1).join(', ')+' and '+PROVIDER_LABELS[PROVIDER_LABELS.length-1];
const CAP_LABEL:Record<SiteCapability,string>={order_status:'order status',payment_history:'payment history',failed_payment:'failed-payment answers',invoice:'invoice links',renewal:'renewal dates',refund_status:'refund status'};
const ALL_CAPS=Object.keys(CAP_LABEL) as SiteCapability[];
const list=(xs:string[])=>xs.length<2?xs.join(''):xs.slice(0,-1).join(', ')+' and '+xs[xs.length-1];
/* Generated from each provider's `missing` capabilities, e.g. "Adyen covers order status and invoice
   links only, and Mollie has no invoice links." Empty when every enabled provider supports every lookup. */
export const capabilityExceptions=()=>{
 const parts=SITE_BILLING_PROVIDERS.filter(p=>p.missing.length).map(p=>{
  const has=ALL_CAPS.filter(c=>!p.missing.includes(c));
  return has.length<p.missing.length?`${p.label} covers ${list(has.map(c=>CAP_LABEL[c]))} only`:`${p.label} has no ${list(p.missing.map(c=>CAP_LABEL[c]))}`;
 });
 return parts.length?(parts.length<2?parts[0]:parts.slice(0,-1).join(', ')+', and '+parts[parts.length-1])+'.':'';
};
