import {NextResponse,type NextRequest} from 'next/server';
import {buildCsp,newNonce} from './lib/csp';
/* Per-request nonce-based Content-Security-Policy (lib/csp.ts) plus a request id for error monitoring.
   The CSP goes on the request too, which is where Next.js reads the nonce for its own scripts. The other
   security headers stay in next.config.ts. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function proxy(request:NextRequest){
 const nonce=newNonce();
 const csp=buildCsp({nonce,pathname:request.nextUrl.pathname,dev:process.env.NODE_ENV==='development'});
 const headers=new Headers(request.headers);
 headers.set('x-nonce',nonce);
 headers.set('Content-Security-Policy',csp);
 const given=request.headers.get('x-request-id');
 headers.set('x-request-id',given&&UUID.test(given)?given:crypto.randomUUID());
 const response=NextResponse.next({request:{headers}});
 response.headers.set('Content-Security-Policy',csp);
 return response;
}
export const config={
 matcher:[{source:'/((?!_next/static|_next/image|favicon.ico).*)',missing:[{type:'header',key:'next-router-prefetch'},{type:'header',key:'purpose',value:'prefetch'}]}],
};
