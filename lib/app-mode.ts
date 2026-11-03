/* Deployment mode, from APP_MODE (preview | production, default preview). next.config.ts copies it into
   NEXT_PUBLIC_APP_MODE at build time so client components read the same value.
   Production mode changes wording only: the "fictional data only" warnings leave the product UI and the
   terms. It never turns on payment execution (PROOF_PAYMENTS_ENABLED stays separate and off) and never
   makes billing anything but read-only. The marketing demo stays labelled as a demo in both modes. */
export type AppMode='preview'|'production';
export function appMode():AppMode{
 // The build-time copy wins inside Next.js, so server and client render the same copy; scripts and tests read APP_MODE.
 const v=(process.env.NEXT_PUBLIC_APP_MODE||process.env.APP_MODE||'').trim().toLowerCase();
 return v==='production'?'production':'preview';
}
export const isProduction=()=>appMode()==='production';
/* Pick the copy for the current mode. */
export const modeText=(preview:string,production:string)=>isProduction()?production:preview;
