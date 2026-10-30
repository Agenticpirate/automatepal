import{demoLocked}from'../../../lib/demo-open';
import { validOrigin } from "../../../lib/origin";
import { NextRequest,NextResponse } from 'next/server';
import { authenticate,requestContext } from '../../../lib/session';import { proposeAction } from '../../../lib/actions';
import { allowRequest } from '../../../lib/rate-limit';
export async function POST(req:NextRequest) {
 const ctx=await authenticate(req);if(!ctx){const d=demoLocked();if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
 if(!validOrigin(req))return NextResponse.json({error:'Invalid origin'},{status:403});
 if(!allowRequest(ctx.userId))return NextResponse.json({error:'Please wait a minute.'},{status:429});
 try {const pending=await requestContext.run(ctx,()=>proposeAction('simulate_subscriber_activity',{subscribers:9,monthly_price:12}));return NextResponse.json({pending:[pending]});}
 catch{return NextResponse.json({error:'Could not prepare demo.'},{status:503});}
}
