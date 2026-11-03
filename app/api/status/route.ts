import{NextResponse}from'next/server';
import{appMode}from'../../../lib/app-mode';
/* Public status: release, mode (APP_MODE: preview | production) and payment flags. Payment execution and
   billing writes stay off in both modes; billing provider lookups are read-only. */
export function GET(){return NextResponse.json({release:(process.env.APP_REVISION||process.env.RENDER_GIT_COMMIT)?.slice(0,12)??'local',mode:appMode(),proofPaymentExecution:process.env.PROOF_PAYMENTS_ENABLED==='true',billing:'read-only'},{headers:{'Cache-Control':'no-store'}});}
