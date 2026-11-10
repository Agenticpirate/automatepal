// Accessibility audit (WCAG 2.1 A/AA rules of axe-core) of public pages and, signed in as a real LOCAL auth user, the
// dashboard pages. Fails on any serious or critical violation; lists moderate/minor ones. Usage:
//   E2E_APP=http://localhost:3100 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=… SERVICE_ROLE_KEY=… node scripts/verify-a11y.mjs
// Add --all to fail on every violation, --page=/path to audit one page.
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const {E2E_APP: APP, SUPABASE_URL: SB, ANON_KEY: ANON, SERVICE_ROLE_KEY: SERVICE} = process.env;
if (!APP || !SB || !ANON || !SERVICE) { console.error('Set E2E_APP, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY.'); process.exit(1); }
for (const u of [APP, SB]) if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Local hosts only.'); process.exit(1); }
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const strict = process.argv.includes('--all'), only = process.argv.find(a => a.startsWith('--page='))?.slice(7);
const PUBLIC = ['/', '/pricing', '/docs', '/login', '/contact', '/security', '/privacy', '/terms', '/status', '/legal', '/integrations'];
const SIGNED_IN = ['/dashboard', '/owner', '/tickets', '/history', '/knowledge', '/setup', '/plan', '/team', '/leads', '/workspace', '/billing'];
const email = `a11y-${randomUUID().slice(0, 8)}@a11y.example.test`;
const u = await (await fetch(`${SB}/auth/v1/admin/users`, {method: 'POST', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123', email_confirm: true})})).json();
const session = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {method: 'POST', headers: {apikey: ANON, 'Content-Type': 'application/json'}, body: JSON.stringify({email, password: 'local-test-only-123'})})).json();
const storageKey = `sb-${new URL(SB).hostname.split('.')[0]}-auth-token`;
const browser = await chromium.launch({channel: 'chromium'});
let failed = 0;
const summary = [];
async function audit(path, signedIn) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
  if (signedIn) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, [storageKey, JSON.stringify(session)]);
  const page = await ctx.newPage();
  const res = await page.goto(APP + path, {waitUntil: 'networkidle', timeout: 60000});
  await page.waitForTimeout(800);
  await page.addScriptTag({content: AXE});
  const r = await page.evaluate(() => window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations']}));
  await ctx.close();
  const bad = r.violations.filter(v => strict || v.impact === 'serious' || v.impact === 'critical');
  failed += bad.length;
  summary.push(`${bad.length ? 'FAIL' : 'ok  '} ${path} (${res?.status()}) ${r.violations.map(v => `${v.id}[${v.impact}]×${v.nodes.length}`).join(' ') || 'no violations'}`);
  for (const v of bad) for (const n of v.nodes.slice(0, 4)) summary.push(`       ${v.id}: ${n.target.join(' ')} — ${n.failureSummary.split('\n').slice(1, 2).join(' ').trim()}`);
}
try {
  for (const p of PUBLIC) if (!only || only === p) await audit(p, false);
  for (const p of SIGNED_IN) if (!only || only === p) await audit(p, true);
} finally {
  await browser.close();
  await fetch(`${SB}/auth/v1/admin/users/${u.id}`, {method: 'DELETE', headers: {apikey: SERVICE, Authorization: `Bearer ${SERVICE}`}}).catch(() => {});
}
console.log(summary.join('\n'));
if (failed) { console.error(`FAIL accessibility: ${failed} ${strict ? '' : 'serious/critical '}violation(s).`); process.exit(1); }
console.log(`PASS accessibility: ${summary.filter(s => /^(ok|FAIL)/.test(s)).length} pages, no ${strict ? '' : 'serious or critical '}WCAG 2.1 A/AA violations (axe-core).`);
