import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: false,
  async headers(){return [
   {source:'/:path*',headers:[
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
    {key:'Strict-Transport-Security',value:'max-age=31536000'},
    // Embedding remains intentional. Do not use global frame-ancestors or X-Frame-Options.
    {key:'Content-Security-Policy',value:"object-src 'none'; base-uri 'self'; form-action 'self'"},
   ]},
   ...['/login','/dashboard','/proof','/tax','/help','/merchant-demo','/knowledge','/support','/setup','/integrations','/workspace','/tickets','/owner','/operations','/sandbox-catalog','/api/:path*'].map(source=>({source,headers:[{key:'Cache-Control',value:'no-store'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}))
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
