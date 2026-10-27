import { NextRequest, NextResponse } from "next/server";
import { runAgent, ChatMessage } from "../../../lib/agent";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { history?: ChatMessage[]; message?: string };
  if (!body.message) return NextResponse.json({ error: "message required" }, { status: 400 });
  try {
    const out = await runAgent(body.history ?? [], body.message);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
