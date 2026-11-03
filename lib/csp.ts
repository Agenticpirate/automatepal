/* Content-Security-Policy with a per-request nonce (set by proxy.ts). Next.js reads the nonce from the
   request's CSP header and puts it on its own scripts; 'strict-dynamic' lets those scripts load the page's
   chunks, and blocks every other script, inline or external. Styles keep 'unsafe-inline' because React
   style attributes and the self-hosted fonts' inline @font-face rules cannot carry a nonce.
   connect-src: this app and Supabase (sign-in). Model, billing, email and crawl providers are called from
   the server only, so the browser never needs them.
   frame-ancestors: /help is the support widget frame customers embed on their own sites, so it sets none;
   every other page allows only same-origin framing (and also sends X-Frame-Options from next.config.ts). */
export function supabaseOrigins(url=process.env.NEXT_PUBLIC_SUPABASE_URL):string{
 try{if(url){const u=new URL(url),secure=u.protocol==='https:';return `${secure?'https':'http'}://${u.host} ${secure?'wss':'ws'}://${u.host}`;}}catch{/* fall through */}
 return 'https://*.supabase.co wss://*.supabase.co';
}
export const embeddable=(pathname:string)=>pathname==='/help'||pathname.startsWith('/help/');
export function buildCsp(o:{nonce:string;pathname:string;dev?:boolean;supabase?:string}):string{
 const dev=!!o.dev;
 return [
  "default-src 'self'",
  `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic'${dev?" 'unsafe-eval'":''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${o.supabase??supabaseOrigins()}${dev?' ws: http://localhost:* http://127.0.0.1:*':''}`,
  "media-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(embeddable(o.pathname)?[]:["frame-ancestors 'self'"]),
 ].join('; ');
}
export function newNonce():string{const b=new Uint8Array(16);crypto.getRandomValues(b);return btoa(String.fromCharCode(...b));}
