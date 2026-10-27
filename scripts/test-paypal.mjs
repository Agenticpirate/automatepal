// Smoke test: OAuth token + list products against the PayPal sandbox.
// Usage: node --env-file=.env scripts/test-paypal.mjs
const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
if (!id || !secret) { console.error("missing PAYPAL_CLIENT_ID/SECRET in .env"); process.exit(1); }
const tok = await fetch(`${BASE}/v1/oauth2/token`, {
  method: "POST",
  headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials",
}).then(r => r.json());
if (!tok.access_token) { console.error("AUTH FAILED", tok); process.exit(1); }
console.log("oauth ok, token expires in", tok.expires_in, "s");
const products = await fetch(`${BASE}/v1/catalogs/products?page_size=5`, {
  headers: { Authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
console.log("products:", (products.products ?? []).map(p => `${p.id} ${p.name}`));
