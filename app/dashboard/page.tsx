"use client";
import { useEffect, useMemo, useState } from "react";
import { authHeaders } from "../../lib/browser-auth";
import Link from "next/link";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, ColDef, CellStyle, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

type Event = {
  id: string; ts: string; kind: string; source?: string; refId?: string;
  amount?: number; currency?: string; customer?: string; note?: string;
};
type Stats = { totalRevenue: number; mrr: number; activeSubscriptions: number; failedPayments: number; succeededPayments: number };

const KIND_LABEL: Record<string, string> = {
  product_created: "Product created", plan_created: "Plan created",
  subscription_created: "Subscription", order_created: "Order",
  invoice_created:"Invoice draft", order_captured:"Order captured", invoice_sent: "Invoice sent", payment_succeeded: "Payment OK", payment_failed: "Payment FAILED",
};

export default function Dashboard() {
  const [events, setEvents] = useState<Event[]>([]);
  const [error,setError]=useState('');
  const [demo,setDemo]=useState<Stats|null>(null);
  const [showDemo,setShowDemo]=useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    authHeaders().then(headers => fetch("/api/dashboard", {headers})).then((r) => r.json()).then((d) => {
      if(d.error){setError(d.error);return;}
      setEvents(d.events??[]); setStats(d.stats);setDemo(d.demoStats);
    }).catch(()=>setError("Could not load your activity."));
  }, []);

  const cols = useMemo<ColDef<Event>[]>(() => [
    { field: "ts", headerName: "Time", width: 180, valueFormatter: (p) => new Date(p.value).toLocaleString() },
    { field: "kind", headerName: "Event", width: 150, valueFormatter: (p) => KIND_LABEL[p.value] ?? p.value,
      cellStyle: (p): CellStyle | undefined => {
        if (p.value === "payment_failed") return { color: "#dc2626", fontWeight: "600" };
        if (p.value === "payment_succeeded") return { color: "#16a34a" };
        return undefined;
      } },
    { field: "source", headerName: "Source", width: 140 },
    { field: "customer", headerName: "Customer", flex: 1 },
    { field: "amount", headerName: "Amount", width: 110, valueFormatter: (p) => (p.value != null ? `$${Number(p.value).toFixed(2)}` : "") },
    { field: "note", headerName: "Note", flex: 1.4 },
    { field: "refId", headerName: "PayPal ID", flex: 1 },
  ], []);

  const selected=showDemo?demo:stats;
  const card = (label: string, value: string) => (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Revenue dashboard</h1>
          <p className="text-sm text-gray-500">PayPal sandbox recorded activity. Fictional events are labelled simulation.</p>
        </div>
        <Link href="/workspace" className="rounded-lg border px-3 py-2 text-sm">Back to agent</Link>
      </header>
      {error&&<p role="alert" className="mb-4 rounded bg-amber-50 p-4">{error} <Link href="/login" className="underline">Sign in</Link></p>}
      <div className="mb-4 flex gap-3"><button onClick={()=>setShowDemo(false)} className="rounded border p-2 text-sm">PayPal sandbox</button><button onClick={()=>setShowDemo(true)} className="rounded border p-2 text-sm">Fictional demo</button></div>
      <h2 className="mb-3 text-sm font-semibold">{showDemo?'FICTIONAL DEMO - not real revenue':'PAYPAL SANDBOX - recorded events only'}</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {card("MRR", selected ? `$${selected.mrr.toFixed(2)}` : "-")}
        {card("Total revenue", selected ? `$${selected.totalRevenue.toFixed(2)}` : "-")}
        {card("Active subs", selected ? String(selected.activeSubscriptions) : "-")}
        {card("Failed payments", selected ? String(selected.failedPayments) : "-")}
        {card("Succeeded", selected ? String(selected.succeededPayments) : "-")}
      </div>
      <p className="mb-3 text-xs text-gray-400">PayPal is a trademark of PayPal, Inc. AutomatePal is not affiliated with or endorsed by PayPal.</p>
      <div style={{ height: 560 }}>
        <AgGridReact
          theme={themeQuartz}
          rowData={events.filter(e=>e.source===(showDemo?"simulation":"paypal_sandbox"))}
          columnDefs={cols}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          pagination
          paginationPageSize={20}
        />
      </div>
    </main>
  );
}
