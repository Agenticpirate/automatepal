/* Company details used by the legal pages. Only facts already published elsewhere on the site are used
   (the operator named in the footer and the contact address, whose domain receives mail). The owner still has
   to confirm three details, marked OWNER TO FILL below; until then the pages say plainly that they are
   available on request instead of showing a placeholder or an invented value. */
import {CONTACT_EMAIL,COPYRIGHT_HOLDER} from './site';
export const OWNER_TO_FILL='[OWNER TO FILL]';
export const LEGAL={
 entity:COPYRIGHT_HOLDER,                                                     // OWNER TO FILL: registered entity name, if not an individual
 address:`a postal address available on request from ${CONTACT_EMAIL}`,   // OWNER TO FILL: registered postal address
 governingLaw:`the law named in a signed agreement; ask ${CONTACT_EMAIL} for the governing-law clause before you rely on these terms`, // OWNER TO FILL
 contactEmail:CONTACT_EMAIL,
 dpaContact:`${COPYRIGHT_HOLDER}, reachable at ${CONTACT_EMAIL}`,
};
export const LEGAL_UPDATED='2026-11-02';
/* Subprocessors. Billing providers are listed only as optional: they receive data only when an owner connects them. */
export const SUBPROCESSORS:{name:string;purpose:string;data:string;location:string;when:string}[]=[
 {name:'Supabase',purpose:'Sign-in, Postgres database and vector search',data:'Account email and profile, workspace content, knowledge sources, conversations and transcripts, tickets, audit metadata',location:'AWS us-east-1 (United States)',when:'Always'},
 {name:'Cloudflare',purpose:'Application hosting (Workers), DNS and network edge',data:'Requests in transit; request logs with metadata only',location:'Cloudflare global network',when:'Always'},
 {name:'Anthropic (Claude)',purpose:'Answer generation, grounding checks and conversation labels',data:'Visitor questions, the matching published source passages, and short conversation excerpts for labels',location:'Anthropic-managed (United States)',when:'When ANTHROPIC_API_KEY is configured'},
 {name:'Google Gemini API',purpose:'Embeddings, and answers when Claude is not configured',data:'Source text you consented to process and visitor questions',location:'Google-managed',when:'Always for embeddings'},
 {name:'Google Sign-In',purpose:'Identity provider for Google sign-in',data:'Email, name and basic profile',location:'Google-managed',when:'When you sign in with Google'},
 {name:'Context.dev',purpose:'Optional browser rendering of JavaScript-only pages during a website import',data:'Public page URLs you chose to import',location:'Context.dev-managed',when:'Only when you turn on browser rendering for an import'},
 {name:'Resend',purpose:'Email delivery',data:'Recipient address, subject and text of owner alerts, digests, invites and replies you choose to email',location:'Resend-managed (United States)',when:'When RESEND_API_KEY is configured'},
 {name:'PayPal, Stripe, Dodo Payments, Razorpay, Paddle, Square, Adyen, Mollie, Chargebee, Lemon Squeezy',purpose:'Read-only billing lookups for your own customers',data:'The order, invoice or subscription reference a verified visitor gives, sent to your own provider account',location:'Provider-managed',when:'Only for a provider an owner connects'},
 {name:'GitHub',purpose:'Scheduled jobs and uptime checks (GitHub Actions)',data:'No customer data; the app URL and a job secret',location:'GitHub-managed',when:'When the workflows are enabled'},
];
