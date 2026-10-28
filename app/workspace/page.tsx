"use client";
import { useEffect, useState } from "react";
import { browserAuth, authHeaders } from "../../lib/browser-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Pending = {id:string;tool:string;args:Record<string,unknown>};
type Msg = { role: "user" | "model"; text: string };

const SUGGESTIONS = [
  "I sell a Notion template pack for $19 one-time. Set it up.",
  "Create a Pro plan at $12/month for my SaaS, ShipFast.",
  "Seed 25 demo subscribers at $12/month.",
  "What's my MRR and how many failed payments?",
  "Draft a dunning email for customers with failed payments.",
];

export default function Home() {
  const router=useRouter();
  const [messages, setMessages] = useState<Msg[]>([
    { role: "model", text: "Hi, I'm AutomatePal. Describe your product and I can help set up PayPal sandbox products, plans and checkout links. Sign in to keep your activity private. No real money moves." },
  ]);
  const [pending,setPending]=useState<Pending[]>([]);
  const [email,setEmail]=useState('');
  useEffect(()=>{
    browserAuth()?.auth.getSession().then(({data})=>setEmail(data.session?.user.email??''));
    authHeaders().then(headers=>fetch('/api/actions',{headers})).then(r=>r.json()).then(d=>setPending(d.actions??[])).catch(()=>{});
  },[]);
  async function decide(id:string,decision:'confirm'|'cancel') {
    setBusy(true);
    try {
      const res=await fetch('/api/actions',{method:'POST',headers:{'Content-Type':'application/json',...await authHeaders()},body:JSON.stringify({id,decision})});
      const d=await res.json();setMessages(m=>[...m,{role:'model',text:(d.reply??d.error)+(d.result?'\n'+JSON.stringify(d.result,null,2):'')}]);
      if(res.ok||res.status===409||res.status===503)setPending(p=>p.filter(a=>a.id!==id));
    } catch {setMessages(m=>[...m,{role:'model',text:'Network error. Check activity before retrying this action.'}]);}
    finally {setBusy(false);}
  }
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function prepareDemo() {
    setBusy(true);
    try {const r=await fetch('/api/demo',{method:'POST',headers:await authHeaders()});const d=await r.json();if(d.pending)setPending(p=>[...p,...d.pending]);else setMessages(m=>[...m,{role:'model',text:d.error}]);}
    catch {setMessages(m=>[...m,{role:'model',text:'Could not prepare demo. Try again later.'}]);}
    finally{setBusy(false);}
  }
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
      if(data.pending)setPending(p=>[...p,...data.pending]);
      setMessages([...next, { role: "model", text: data.reply ?? data.error ?? "Something went wrong." }]);
    } catch {
      setMessages([...next, { role: "model", text: "Network error - try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-xl font-bold">AutomatePal</h1>
          <p className="text-sm text-gray-500">AI billing &amp; revenue copilot on PayPal (sandbox)</p>
        </div>
        {email?<button className="text-sm underline" onClick={async()=>{await browserAuth()?.auth.signOut();setEmail('');setPending([]);router.push('/login');}}>Sign out</button>:<Link href="/login" className="text-sm underline">Sign in</Link>}
        <Link href="/knowledge" className="rounded-lg border px-3 py-2 text-sm">Knowledge</Link>
        <Link href="/tax" className="rounded-lg border px-3 py-2 text-sm">Tax worksheet</Link>
        <Link href="/setup" className="rounded-lg border px-3 py-2 text-sm">Quick setup</Link>
        <Link href="/proof" className="rounded-lg border px-3 py-2 text-sm">Proof-to-Pay</Link>
        <Link href="/dashboard" className="rounded-lg bg-black px-3 py-2 text-sm text-white">Revenue dashboard</Link>
      </header>

      <aside className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm"><strong>Sandbox studio</strong><p className="my-1 text-gray-600">{email?'Your account is private. Review each creation before it runs.':'Sign in to try the beta. Public visitors can explore fictional data; PayPal tools are owner-only.'}</p><button disabled={busy} onClick={prepareDemo} className="mt-2 rounded border border-blue-200 bg-white px-3 py-2 text-xs">Prepare fictional demo (no AI needed)</button></aside>
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

      {pending.map(a=><section key={a.id} className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><h2 className="font-semibold">Review: {a.tool.replaceAll('_',' ')}</h2><p className="text-xs">Sandbox only. Nothing has run yet.</p><pre className="my-3 overflow-auto text-xs">{JSON.stringify(a.args,null,2)}</pre><div className="flex gap-3"><button disabled={busy} onClick={()=>decide(a.id,'confirm')} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">Confirm exact action</button><button disabled={busy} onClick={()=>decide(a.id,'cancel')} className="rounded border px-4 py-2 text-sm">Cancel</button></div></section>)}
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
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
      </form>
    </main>
  );
}
