import { NextResponse } from "next/server";
import { allEvents, computeStats } from "../../../lib/store";


export async function GET() {
  const [events, stats] = await Promise.all([allEvents(), computeStats()]);
  return NextResponse.json({ stats, events: [...events].reverse() });
}
