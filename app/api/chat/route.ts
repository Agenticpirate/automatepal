import { NextRequest, NextResponse } from "next/server";
import { runAgent, ChatMessage } from "../../../lib/agent";


export async function POST(req: NextRequest) {
  const body = (await req.json()) as { history?: ChatMessage[]; message?: string };
  if (!body.message) return NextResponse.json({ error: "message required" }, { status: 400 });
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ reply: "I'm not configured yet - add GEMINI_API_KEY to .env (free key: https://aistudio.google.com/apikey) and restart." });
  }
  if (!process.env.PAYPAL_CLIENT_ID) {
    return NextResponse.json({ reply: "PayPal sandbox credentials are missing - add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env and restart." });
  }
  try {
    const out = await runAgent(body.history ?? [], body.message);
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
