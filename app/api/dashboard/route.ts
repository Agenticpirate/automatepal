import{demoGate}from'../../../lib/demo-open';
import { NextRequest, NextResponse } from "next/server";
import { authenticate, requestContext } from "../../../lib/session";import { allEvents, computeStats } from "../../../lib/store";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const session = await authenticate(req);
  if(!session){const d=demoGate(req,'dashboard');if(d)return d;return NextResponse.json({error:'Please sign in.'},{status:401});}
  try {
    return await requestContext.run(session, async () => {
      const [events,stats,demoStats] = await Promise.all([allEvents(),computeStats(),computeStats("simulation")]);
      return NextResponse.json({stats,demoStats,events:[...events].reverse()},{headers:{"Cache-Control":"no-store"}});
    });
  } catch { return NextResponse.json({error:"Could not load your activity."},{status:503}); }
}
