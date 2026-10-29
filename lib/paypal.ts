// PayPal sandbox REST client for AutomatePal.
// Server-side only. Uses OAuth client credentials against the sandbox base URL.

import { requestContext } from "./session";

const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";

if (BASE !== "https://api-m.sandbox.paypal.com") throw new Error("Only PayPal sandbox is supported");

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) return cachedToken.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(method === "POST" && requestContext.getStore()?.actionId ? {"PayPal-Request-Id": requestContext.getStore()!.actionId!} : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  let json: unknown = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json as { message?: string })?.message ?? text;
    throw new Error(`PayPal ${method} ${path} failed: ${res.status} ${msg}`);
  }
  return json as T;
}

// ---- Catalog: products & plans ----
export const createProduct = (p: unknown) => api("POST", "/v1/catalogs/products", p);
export const listProducts = () => api("GET", "/v1/catalogs/products?page_size=20");
export const createPlan = (p: unknown) => api("POST", "/v1/billing/plans", p);
export const getPlan = (id:string) => {if(!/^P-[A-Z0-9]{1,58}$/.test(id))throw Error("Invalid plan ID");return api("GET", `/v1/billing/plans/${id}`);};
export const listPlans = () => api("GET", "/v1/billing/plans?page_size=20");

// ---- Subscriptions ----
export const createSubscription = (p: unknown) => api("POST", "/v1/billing/subscriptions", p);
export const getSubscription = (id: string) => api("GET", `/v1/billing/subscriptions/${id}`);
export const listSubscriptionsForPlan = (planId: string) =>
  api("GET", `/v1/billing/plans/${planId}/subscriptions?page_size=20`);

// ---- Orders (one-time checkout) ----
export const createOrder = (p: unknown) => api("POST", "/v2/checkout/orders", p);
export const captureOrder = (id: string) => api("POST", `/v2/checkout/orders/${id}/capture`);

// ---- Invoicing ----
export const createInvoiceDraft = (p: unknown) => api("POST", "/v2/invoicing/invoices", p);
export const sendInvoice = (id: string) =>
  api("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true });
export const listInvoices = () => api("GET", "/v2/invoicing/invoices?page_size=20&total_required=true");

// ---- Reporting: transactions (for revenue / failed payments) ----
export async function searchTransactions(startIso: string, endIso: string) {
  const q = new URLSearchParams({ start_date: startIso, end_date: endIso, page_size: "100" });
  return api("GET", `/v1/reporting/transactions?${q.toString()}`);
}

// Proof-to-Pay uses AUTHORIZE orders, never live payment endpoints.
export const getOrder = (id:string) => api("GET", `/v2/checkout/orders/${id}`);
export const authorizeOrder = (id:string) => api("POST", `/v2/checkout/orders/${id}/authorize`, {});
export const getAuthorization = (id:string) => api("GET", `/v2/payments/authorizations/${id}`);
export const captureAuthorization = (id:string,p:unknown) => api("POST", `/v2/payments/authorizations/${id}/capture`, p);
export const voidAuthorization = (id:string) => api("POST", `/v2/payments/authorizations/${id}/void`, {});
