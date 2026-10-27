// Local JSON ledger for AutomatePal.
// Records every entity the agent creates in the PayPal sandbox plus simulated
// subscriber/payment events, so the revenue dashboard and Q&A have real,
// consistent data even where sandbox reporting APIs are sparse.

import { promises as fs } from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "ledger.json");

export type LedgerEvent = {
  id: string;
  ts: string; // ISO
  kind:
    | "product_created"
    | "plan_created"
    | "subscription_created"
    | "order_created"
    | "order_captured"
    | "invoice_created"
    | "invoice_sent"
    | "payment_succeeded" // simulated or observed
    | "payment_failed"; // simulated dunning scenario
  refId?: string; // PayPal id (product/plan/subscription/order/invoice id)
  amount?: number; // major units
  currency?: string;
  customer?: string;
  note?: string;
  meta?: Record<string, unknown>;
};

type Ledger = { events: LedgerEvent[] };

async function readLedger(): Promise<Ledger> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as Ledger;
  } catch {
    return { events: [] };
  }
}

async function writeLedger(l: Ledger) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(l, null, 2));
}

export async function addEvent(e: Omit<LedgerEvent, "id" | "ts">) {
  const l = await readLedger();
  l.events.push({
    ...e,
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
  });
  await writeLedger(l);
}

export async function allEvents() {
  return (await readLedger()).events;
}

// MRR: monthly value of ACTIVE subscription plans seen in the ledger.
export async function computeStats() {
  const events = await allEvents();
  const succeeded = events.filter((e) => e.kind === "payment_succeeded");
  const failed = events.filter((e) => e.kind === "payment_failed");
  const revenue = succeeded.reduce((s, e) => s + (e.amount ?? 0), 0);
  const mrr = events
    .filter((e) => e.kind === "subscription_created")
    .reduce((s, e) => s + (e.amount ?? 0), 0);
  return {
    totalRevenue: Math.round(revenue * 100) / 100,
    mrr: Math.round(mrr * 100) / 100,
    currency: "USD",
    activeSubscriptions: events.filter((e) => e.kind === "subscription_created").length,
    failedPayments: failed.length,
    succeededPayments: succeeded.length,
  };
}
