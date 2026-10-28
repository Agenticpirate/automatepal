import{NextResponse}from'next/server';
export function GET(){return NextResponse.json({release:process.env.RENDER_GIT_COMMIT?.slice(0,12)??'local',mode:'fictional-sandbox-preview',proofPaymentExecution:process.env.PROOF_PAYMENTS_ENABLED==='true'},{headers:{'Cache-Control':'no-store'}});}
