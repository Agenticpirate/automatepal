import {limitedJson} from '../../../lib/limited-json';
import { validOrigin } from "../../../lib/origin";
import { NextRequest, NextResponse } from "next/server";
import { allowRequest } from "../../../lib/rate-limit";
import { z } from "zod";
import { authenticate, requestContext } from "../../../lib/session";
import { runAgent } from "../../../lib/agent";
const input = z.object({
  history: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(8000) })).max(30).default([]),
  message: z.string().trim().min(1).max(4000),
});
export async function POST(req: NextRequest) {
  if (Number(req.headers.get("content-length") ?? 0) > 128000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const session = await authenticate(req);
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!allowRequest(session.userId)) return NextResponse.json({error:"Please wait a minute before sending more messages."},{status:429});
  if (!validOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  let body;
  try { body = input.parse(await limitedJson(req,128000)); }
  catch { return NextResponse.json({ error: "Enter a message of up to 4000 characters." }, { status: 400 }); }
  if (!process.env.GEMINI_API_KEY || !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET)
    return NextResponse.json({ error: "Sandbox setup is incomplete." }, { status: 503 });
  try { return NextResponse.json(await requestContext.run(session, () => runAgent(body.history, body.message))); }
  catch { return NextResponse.json({ error: "The AI provider is temporarily unavailable. Check your activity before retrying a creation request." }, { status: 503 }); }
}
