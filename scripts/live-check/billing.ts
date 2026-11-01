// Real read-only check of a billing provider, TEST mode only, through the production adapter.
// Usage: npm run billing:live-check -- <provider>
// Reads credentials from the environment (.env loaded if present). Missing credentials print
// "<provider>: SKIPPED (not configured) - NOT VERIFIED" and exit 0. Output is limited to provider,
// mode, outcome, HTTP class, record counts and redacted ids, and every line passes through redact().
// The guarded allowlist is active, so only the adapter's GET reads (plus the named auth exchange) can happen.
import {providerDefinition, PROVIDERS} from '../../lib/billing/core/registry';
import {redact, redactId} from '../../lib/billing/core/redact';
import {matchReference} from '../../lib/billing/core/verify';
import {filterScoped} from '../../lib/billing/core/scope';
import {BillingError} from '../../lib/billing/core/types';

try { process.loadEnvFile('.env'); } catch { /* no .env: rely on the process environment */ }

// Live-check names only. Production credentials are stored per workspace, encrypted.
const ENV: Record<string, {cred: Record<string, string>; config?: Record<string, string>}> = {
  paypal: {cred: {clientId: 'PAYPAL_CLIENT_ID', clientSecret: 'PAYPAL_CLIENT_SECRET'}},
  stripe: {cred: {apiKey: 'STRIPE_TEST_RESTRICTED_KEY'}},
  dodo: {cred: {apiKey: 'DODO_TEST_API_KEY'}},
  razorpay: {cred: {keyId: 'RAZORPAY_TEST_KEY_ID', keySecret: 'RAZORPAY_TEST_KEY_SECRET'}},
  paddle: {cred: {apiKey: 'PADDLE_SANDBOX_API_KEY'}},
  square: {cred: {accessToken: 'SQUARE_SANDBOX_ACCESS_TOKEN'}},
  adyen: {cred: {apiKey: 'ADYEN_TEST_API_KEY'}, config: {merchantAccount: 'ADYEN_TEST_MERCHANT_ACCOUNT'}},
  mollie: {cred: {apiKey: 'MOLLIE_TEST_API_KEY'}},
  chargebee: {cred: {apiKey: 'CHARGEBEE_TEST_API_KEY'}, config: {site: 'CHARGEBEE_TEST_SITE'}},
  lemonsqueezy: {cred: {apiKey: 'LEMONSQUEEZY_TEST_API_KEY'}},
};
const say = (line: string) => console.log(redact(line));
const httpClass = (s: number) => String(s);
const firstArray = (v: unknown): unknown[] | null => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') for (const k of ['items', 'data', 'transactions', 'payments', 'plans', 'objects']) { const x = (v as Record<string, unknown>)[k]; if (Array.isArray(x)) return x; }
  return null;
};

async function main() {
  const provider = process.argv[2];
  const modeArg = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'test';
  if (!provider || !ENV[provider]) { say(`Usage: npm run billing:live-check -- <${Object.keys(ENV).join('|')}>`); process.exit(2); }
  if (modeArg !== 'test') { say(`${provider}: refused - the live check runs TEST mode only`); process.exit(2); }
  const map = ENV[provider];
  const pickEnv = (m: Record<string, string> = {}) => Object.fromEntries(Object.entries(m).map(([k, name]) => [k, (process.env[name] ?? '').trim()]));
  const cred = pickEnv(map.cred), config = pickEnv(map.config);
  if ([...Object.values(cred), ...Object.values(config)].some((v) => !v)) { say(`${provider}: SKIPPED (not configured) - NOT VERIFIED`); return; }
  const def = providerDefinition(provider);
  if (!def || !PROVIDERS[def.id]?.enabled) { say(`${provider}: SKIPPED (adapter not built or not enabled) - NOT VERIFIED`); return; }
  const check = def.validateCredential('test', cred, config);
  if (!check.ok) { say(`${provider}: test FAIL credential rejected locally (${check.code})`); process.exitCode = 1; return; }

  const statuses: number[] = [];
  let lastList: number | null = null;
  const deps = {
    fetch: async (u: string, init: RequestInit) => {
      const res = await fetch(u, init);
      statuses.push(res.status);
      say(`${provider} test request ${statuses.length}: ${String(init.method ?? 'GET')} HTTP ${httpClass(res.status)}`);
      if (res.ok) { const arr = firstArray(await res.clone().json().catch(() => null)); if (arr) lastList = arr.length; }
      return res;
    },
    now: Date.now, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), connectionId: `live-check:${provider}`, config,
  };
  const adapter = def.createAdapter(cred, 'test', deps);
  try {
    const t = await adapter.testConnection();
    say(`${provider}: test connect check PASS (read-only list returned ${lastList ?? 0} record${lastList === 1 ? '' : 's'})`);
    if (t.warning) say(`${provider}: note: ${t.warning}`);
  } catch (e) {
    say(`${provider}: test connect check FAIL (${e instanceof BillingError ? e.code : 'error'}${statuses.length ? `, last HTTP ${httpClass(statuses.at(-1)!)}` : ''})`);
    process.exitCode = 1; return;
  }
  const ref = process.env.BILLING_LIVE_CHECK_REFERENCE?.trim(), email = process.env.BILLING_LIVE_CHECK_EMAIL?.trim();
  if (!ref || !email) { say(`${provider}: verify + order_status lookup SKIPPED (set the live-check reference and email variables listed in .env.example)`); return; }
  const m = matchReference(def, ref);
  if (!m) { say(`${provider}: verify SKIPPED (reference matches no ${def.label} pattern)`); return; }
  try {
    const v = await adapter.verifyCustomer(m.value, email);
    say(`${provider}: verify outcome ${v.status}`);
    if (v.status !== 'verified') return;
    const records = filterScoped(v.scope, await adapter.lookup(v.scope, 'order_status'));
    say(`${provider}: order_status lookup returned ${records.length} record${records.length === 1 ? '' : 's'}: ${records.map((r) => `${r.kind} ${redactId(r.id)} ${r.status}`).join('; ') || 'none'}`);
  } catch (e) {
    say(`${provider}: verify/lookup FAIL (${e instanceof BillingError ? e.code : 'error'})`);
    process.exitCode = 1;
  }
}
main();
