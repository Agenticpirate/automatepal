// Transactional local development store. A persistent disk or Postgres adapter
// is required before hosting: ephemeral hosting must not be called durable.
import { requestContext } from "./session";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LedgerEvent = {
  id: string; ts: string;
  kind: "product_created" | "plan_created" | "subscription_created" |
    "order_created" | "order_captured" | "invoice_created" | "invoice_sent" |
    "payment_succeeded" | "payment_failed";
  source: "simulation" | "paypal_sandbox";
  refId?: string; amount?: number; currency?: string; customer?: string;
  note?: string; meta?: Record<string, unknown>;
};
let db: Database.Database | undefined;
function database() {
  if (db) return db;
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, "automatepal.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, ts TEXT NOT NULL, source TEXT NOT NULL,
    kind TEXT NOT NULL, payload TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS events_source_ts ON events(source, ts);`);
  return db;
}
export async function addEvent(e: Omit<LedgerEvent, "id" | "ts" | "source"> & { source?: LedgerEvent["source"] }) {
  const event: LedgerEvent = { ...e, source: e.source ?? "paypal_sandbox", id: randomUUID(), ts: new Date().toISOString() };
  const ctx = requestContext.getStore();
  if (ctx) {
    const {error} = await ctx.client.from("billing_events").insert({id:event.id,user_id:ctx.userId,ts:event.ts,source:event.source,kind:event.kind,payload:event});
    if (error) throw new Error("Could not persist billing event");
    return event;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Authenticated storage required");
  database().prepare("INSERT INTO events (id, ts, source, kind, payload) VALUES (?, ?, ?, ?, ?)").run(event.id, event.ts, event.source, event.kind, JSON.stringify(event));
  return event;
}
export async function allEvents(source?: LedgerEvent["source"]) {
  const ctx = requestContext.getStore();
  if (ctx) {
    let query = ctx.client.from("billing_events").select("payload").eq("user_id", ctx.userId).order("ts").limit(1000);
    if (source) query = query.eq("source",source);
    const {data,error} = await query;
    if (error) throw new Error("Could not load billing events");
    return (data ?? []).map(r => r.payload as LedgerEvent);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Authenticated storage required");
  const rows = source
    ? database().prepare("SELECT payload FROM events WHERE source = ? ORDER BY rowid").all(source)
    : database().prepare("SELECT payload FROM events ORDER BY rowid").all();
  return (rows as { payload: string }[]).map(r => JSON.parse(r.payload) as LedgerEvent);
}
export async function computeStats(source: LedgerEvent["source"] = "paypal_sandbox") {
  const events = await allEvents(source);
  const succeeded = events.filter(e => e.kind === "payment_succeeded");
  const latest = new Map<string, LedgerEvent>();
  for (const e of events) if (e.customer && ["payment_succeeded", "payment_failed"].includes(e.kind)) latest.set(e.customer, e);
  const subscriptions = events.filter(e => e.kind === "subscription_created" && (source === "simulation" || e.meta?.status === "ACTIVE"));
  const currencies = [...new Set(events.filter(e => e.amount !== undefined).map(e => e.currency ?? "USD"))];
  if (currencies.some(c => c !== "USD")) throw new Error("Mixed currency analytics are not supported; use a currency-specific report.");
  return {
    source, totalRevenue: Math.round(succeeded.reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100,
    mrr: Math.round(subscriptions.reduce((s, e) => s + (e.amount ?? 0), 0) * 100) / 100,
    currency: "USD", activeSubscriptions: subscriptions.length,
    failedPayments: [...latest.values()].filter(e => e.kind === "payment_failed").length,
    succeededPayments: succeeded.length,
    coverage: "Only recorded events. Plan and checkout creation do not count as revenue or active subscriptions.",
  };
}
