import type { NextConfig } from "next";

/* Content Security Policy: set per request with a nonce by proxy.ts (lib/csp.ts), because a nonce must be
   fresh for every response. The other security headers stay here. */
const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  poweredByHeader: false,
  // APP_MODE (preview | production) is read on the server; client components get the same value here.
  env: { NEXT_PUBLIC_APP_MODE: process.env.APP_MODE === 'production' ? 'production' : 'preview' },
  async headers(){return [
   {source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
    {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains'},
   ]},
   // Every page except the /help widget frame refuses framing by other sites (clickjacking); the CSP
   // frame-ancestors rule from proxy.ts says the same. Same-origin framing stays allowed.
   {source:'/:path((?!help$|help/).*)',headers:[
    {key:'X-Frame-Options',value:'SAMEORIGIN'},
   ]},
   // widget.js is the embed customers load on every page view. Short cache avoids a revalidation round trip per repeat view; at most 5 min stale plus 10 min SWR after a deploy.
   {source:'/widget.js',headers:[{key:'Cache-Control',value:'public, max-age=300, stale-while-revalidate=600'}]},
   ...['/login','/dashboard','/proof','/tax','/help','/merchant-demo','/knowledge','/support','/setup','/integrations','/workspace','/tickets','/billing','/owner','/operations','/sandbox-catalog','/team','/invite','/mcp','/leads','/history','/plan','/api/:path*'].map(source=>({source,headers:[{key:'Cache-Control',value:'no-store'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]})),
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
