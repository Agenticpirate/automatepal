"use client";
import { useState } from "react";
import { authHeaders } from "../../lib/browser-auth";
import Link from "next/link";

type Msg = { role: "user" | "model"; text: string };

const SUGGESTIONS = [
  "I sell a Notion template pack for $19 one-time. Set it up.",
  "Create a Pro plan at $12/month for my SaaS, ShipFast.",
  "Seed 25 demo subscribers at $12/month.",
  "What's my MRR and how many failed payments?",
  "Draft a dunning email for customers with failed payments.",
  "Draft an invoice for demo@example.invalid for $240.",
];

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "model", text: "Hi, I'm AutomatePal. Describe your product and I can help set up PayPal sandbox products, plans and checkout links. Sign in to keep your activity private. No real money moves." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...await authHeaders() },
        body: JSON.stringify({ history: messages, message: text }),
      });
      const data = await res.json();
      setMessages([...next, { role: "model", text: data.reply ?? data.error ?? "Something went wrong." }]);
    } catch {
      setMessages([...next, { role: "model", text: "Network error - try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      <header className="flex items-center justify-between border-b pb-3">
        <div>
          <h1 className="text-xl font-bold">AutomatePal</h1>
          <p className="text-sm text-gray-500">AI billing &amp; revenue copilot on PayPal (sandbox)</p>
        </div>
        <Link href="/login" className="text-sm underline">Sign in</Link>
        <Link href="/dashboard" className="rounded-lg bg-black px-3 py-2 text-sm text-white">Revenue dashboard</Link>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-left text-sm ${m.role === "user" ? "bg-black text-white" : "bg-gray-100"}`}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-gray-400">Working with PayPal...</div>}
      </div>

      <div className="mb-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="rounded-full border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">{s}</button>
        ))}
      </div>

      <p className="pb-2 text-center text-xs text-gray-400">PayPal is a trademark of PayPal, Inc. AutomatePal is not affiliated with or endorsed by PayPal.</p>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t pt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your product, or ask about revenue..."
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
      </form>
    </main>
  );
}
