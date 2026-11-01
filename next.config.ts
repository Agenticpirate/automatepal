import type { NextConfig } from "next";

/* Content Security Policy. Production gets the full policy; `next dev` keeps the old minimal one because
   hot reload needs eval and a local websocket. The browser only talks to this origin and Supabase (auth);
   Gemini, PayPal sandbox and GitHub are called server-side. 'unsafe-inline' stays for scripts and styles
   because the app ships inline styles and Next's inline bootstrap without nonces; external script origins
   are still blocked. */
const prod = process.env.NODE_ENV === 'production';
const supabase = (() => { try { return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : ''; } catch { return ''; } })();
const supabaseSrc = supabase ? `https://${supabase} wss://${supabase}` : 'https://*.supabase.co wss://*.supabase.co';
const csp = (frameAncestors?: string) => (prod ? [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseSrc}`,
  "media-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
] : ["object-src 'none'", "base-uri 'self'", "form-action 'self'"])
  .concat(frameAncestors ? [`frame-ancestors ${frameAncestors}`] : []).join('; ');

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  poweredByHeader: false,
  async headers(){return [
   {source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
    {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains'},
    // /help is the widget frame customers embed on their own sites, so it keeps no frame restriction.
    {key:'Content-Security-Policy',value:csp()},
   ]},
   // Every other page refuses framing by other sites (clickjacking). Same-origin framing stays allowed.
   {source:'/:path((?!help$|help/).*)',headers:[
    {key:'Content-Security-Policy',value:csp("'self'")},
    {key:'X-Frame-Options',value:'SAMEORIGIN'},
   ]},
   // widget.js is the embed customers load on every page view. Short cache avoids a revalidation round trip per repeat view; at most 5 min stale plus 10 min SWR after a deploy.
   {source:'/widget.js',headers:[{key:'Cache-Control',value:'public, max-age=300, stale-while-revalidate=600'}]},
   ...['/login','/dashboard','/proof','/tax','/help','/merchant-demo','/knowledge','/support','/setup','/integrations','/workspace','/tickets','/billing','/owner','/operations','/sandbox-catalog','/team','/invite','/mcp','/leads','/api/:path*'].map(source=>({source,headers:[{key:'Cache-Control',value:'no-store'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]})),
   // Design previews are not part of the public site.
   {source:'/preview/:path*',headers:[{key:'X-Robots-Tag',value:'noindex, nofollow'}]},
  ];},
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
