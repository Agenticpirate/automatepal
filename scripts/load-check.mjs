// Load check (no new dependency): Node fetch with a fixed concurrency against a LOCAL production build.
// Drives these paths and reports p50/p95/p99, max and error rate for each:
//   1. GET  /api/status
//   2. GET  /widget.js (the launcher every merchant page loads)
//   3. GET  /api/widget?token=...  (widget config: case lookup + settings validation)
//   4. POST /api/support {action:'answer'} with a published exact custom response (the cached answer path:
//      reserve, exact match, finish, transcript write; no model call), one simulated shopper IP per conversation
//   5. POST /api/v1/chat with a chat:write token (token check, conversation open, same answer path)
//   6. POST /api/paypal/webhook without signature headers (rejected before PayPal is called) from one address:
//      the first 120 in a minute answer 400, the rest 429 (per-IP cap), so PayPal-side cost stays bounded
// Paths 5 and 6 need SUPABASE_SERVICE_ROLE_KEY (local) in the environment; without it they are skipped.
// Setup is seeded straight into the LOCAL database (refuses any other host) and removed afterwards.
// The build must point at the local Supabase, so build first with the local URL and anon key:
//   export DOCKER_HOST=unix://$HOME/.docker/run/docker.sock
//   eval "$(npx supabase status --workdir .supabase-local -o env | grep -E '^(API_URL|ANON_KEY)=')"
//   NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY npm run build
//   LOAD_SUPABASE_URL=$API_URL LOAD_SUPABASE_ANON_KEY=$ANON_KEY node scripts/load-check.mjs
// Optional: LOAD_N (status requests, default 400), LOAD_C (concurrency, default 16), LOAD_OUT (JSON report path).
// The answer path is limited by design (6 per conversation per minute in-process, 20 per conversation and
// 100 per workspace per day in the database), so it uses 15 conversations x 6 questions = 90 requests.
import pg from 'pg';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
const DB = process.env.LOCAL_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SB = process.env.LOAD_SUPABASE_URL, ANON = process.env.LOAD_SUPABASE_ANON_KEY;
for (const u of [DB, SB]) { if (!u) { console.error('Set LOAD_SUPABASE_URL and LOAD_SUPABASE_ANON_KEY (local Supabase).'); process.exit(1); } if (!['127.0.0.1', 'localhost'].includes(new URL(u).hostname)) { console.error('Refusing non-local host ' + new URL(u).hostname); process.exit(1); } }
const PORT = Number(process.env.LOAD_PORT || 3281), BASE = `http://127.0.0.1:${PORT}`;
// next start sees its own origin as localhost:PORT; the widget config accepts the app's own origin.
const APP_ORIGIN = `http://localhost:${PORT}`;
const N = Number(process.env.LOAD_N || 400), C = Number(process.env.LOAD_C || 16);
const sha = (t) => createHash('sha256').update(t).digest('hex');
const db = new pg.Client({connectionString: DB});
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY, chatToken = 'ap_ro_' + randomBytes(32).toString('hex');
const ws = randomUUID(), cases = Array.from({length: 15}, () => ({id: randomUUID(), token: randomBytes(32).toString('hex')}));
const QUESTION = 'What are your opening hours?';
async function seed() {
  await db.query('insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,$2,$3,$3,$4,now(),$5,$5,now(),now())', [ws, '00000000-0000-0000-0000-000000000000', 'authenticated', `load-${ws.slice(0, 8)}@example.test`, '{}']);
  await db.query("insert into widget_settings(user_id) values($1) on conflict do nothing", [ws]);
  await db.query('insert into custom_responses(user_id,question,answer,published) values($1,$2,$3,true)', [ws, QUESTION, 'We are open Monday to Friday, 9:00 to 17:00 (fictional load-check answer).']);
  await db.query("select public.set_manual_plan($1,'growth')", [ws]);
  await db.query("insert into readonly_tokens(user_id,label,token_hash,scope,expires_at) values($1,'load check',$2,'chat:write',now()+interval '1 hour')", [ws, sha(chatToken)]);
  for (const c of cases) await db.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Load check order',19)", [c.id, ws, sha(c.token)]);
}
async function cleanup() { try { await db.query('delete from auth.users where id=$1', [ws]); } catch (e) { console.error('cleanup failed:', e.message); } }
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] * 10) / 10; };
async function drive(name, jobs, concurrency, expect = (st) => st >= 200 && st < 300) {
  const times = [], errors = {}, statuses = {}; let i = 0; const t0 = performance.now();
  async function worker() { while (i < jobs.length) { const job = jobs[i++]; const s = performance.now(); let code = 'network'; try { const r = await job(); code = r.status; statuses[code] = (statuses[code] ?? 0) + 1; await r.arrayBuffer(); if (expect(r.status)) { times.push(performance.now() - s); continue; } } catch {} errors[code] = (errors[code] ?? 0) + 1; } }
  await Promise.all(Array.from({length: Math.min(concurrency, jobs.length)}, worker));
  const wall = (performance.now() - t0) / 1000, failed = Object.values(errors).reduce((a, b) => a + b, 0);
  return {name, statuses, requests: jobs.length, concurrency: Math.min(concurrency, jobs.length), ok: times.length, errorRate: Math.round(10000 * failed / jobs.length) / 100, errors, p50: pct(times, 50), p95: pct(times, 95), p99: pct(times, 99), max: times.length ? Math.round(Math.max(...times)) : null, rps: Math.round(jobs.length / wall * 10) / 10};
}
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], {stdio: 'ignore', env: {...process.env, PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || 'WH-LOADCHECK', NEXT_PUBLIC_SUPABASE_URL: SB, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, NEXT_PUBLIC_DEMO_OPEN: 'false', NODE_ENV: 'production', APP_URL: APP_ORIGIN}});
try {
  await db.connect();
  await seed();
  const dl = Date.now() + 90000; while (Date.now() < dl) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  const probe = await fetch(`${BASE}/api/widget?token=${cases[0].token}&path=/`, {headers: {origin: APP_ORIGIN}});
  if (probe.status !== 200) throw Error(`Widget config probe returned ${probe.status} ${(await probe.text()).slice(0, 120)}. Is the build pointing at the local Supabase? (see the header of this script)`);
  // Warm-up (first requests compile route handlers), not counted.
  await Promise.all([fetch(BASE + '/api/status'), fetch(`${BASE}/api/widget?token=${cases[1].token}&path=/`, {headers: {origin: APP_ORIGIN}})]);
  const results = [];
  results.push(await drive('GET /api/status', Array.from({length: N}, () => () => fetch(BASE + '/api/status')), C));
  results.push(await drive('GET /widget.js', Array.from({length: N}, () => () => fetch(BASE + '/widget.js')), C));
  results.push(await drive('GET /api/widget (config)', Array.from({length: N}, (_, k) => () => fetch(`${BASE}/api/widget?token=${cases[k % cases.length].token}&path=/`, {headers: {origin: APP_ORIGIN}})), C));
  const answers = cases.flatMap((c) => Array.from({length: 6}, () => () => fetch(BASE + '/api/support', {method: 'POST', headers: {'Content-Type': 'application/json', origin: APP_ORIGIN, 'x-forwarded-for': `203.0.113.${cases.indexOf(c) + 1}`}, body: JSON.stringify({action: 'answer', token: c.token, question: QUESTION})})));
  results.push(await drive('POST /api/support answer (exact custom response)', answers, C));
  if (SERVICE) {
    // 30 per token per minute by design: one minute's worth, each opening its own conversation.
    results.push(await drive('POST /api/v1/chat (new conversation + answer)', Array.from({length: 30}, () => () => fetch(BASE + '/api/v1/chat', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + chatToken}, body: JSON.stringify({question: QUESTION})})), Math.min(C, 8)));
    const event = JSON.stringify({id: 'WH-LOAD' + randomBytes(6).toString('hex').toUpperCase(), event_type: 'BILLING.SUBSCRIPTION.UPDATED', resource: {id: 'I-LOADCHECK0001'}});
    const hook = await drive('POST /api/paypal/webhook (unsigned, one address)', Array.from({length: 140}, () => () => fetch(BASE + '/api/paypal/webhook', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.7'}, body: event})), C, (st) => st === 400 || st === 429);
    results.push(hook);
    if (!(hook.statuses[429] >= 15 && hook.statuses[400] <= 125)) { console.error('FAIL webhook per-address cap did not engage: ' + JSON.stringify(hook.statuses)); process.exitCode = 1; }
  } else console.log('SUPABASE_SERVICE_ROLE_KEY not set: chat API and webhook paths skipped.');
  const stored = (await db.query('select count(*)::int n, count(answer)::int a from knowledge_interactions where user_id=$1', [ws])).rows[0];
  const report = {checkedAt: new Date().toISOString(), base: BASE, node: process.version, results, answerRowsStored: stored.n, answerTranscriptsStored: stored.a, notes: 'Local next start on this machine against the local Supabase in Docker; not representative of the hosted free tier.'};
  for (const r of results) console.log(`${r.name.padEnd(52)} n=${r.requests} c=${r.concurrency} ok=${r.ok} err=${r.errorRate}% p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms max=${r.max}ms rps=${r.rps} statuses=${JSON.stringify(r.statuses)}${Object.keys(r.errors).length ? ' errors=' + JSON.stringify(r.errors) : ''}`);
  console.log(`answer rows stored: ${stored.n}, with transcript answer text: ${stored.a}`);
  if (process.env.LOAD_OUT) fs.writeFileSync(process.env.LOAD_OUT, JSON.stringify(report, null, 2));
  const bad = results.filter((r) => r.errorRate > 1);
  if (bad.length) { console.error('FAIL load check: error rate above 1% on ' + bad.map((r) => r.name).join(', ')); process.exitCode = 1; }
  else if (!process.exitCode) console.log('PASS load check: error rate at or below 1% on every path.');
} catch (e) { console.error('FAIL load check:', e.message); process.exitCode = 1; }
finally { await cleanup(); await db.end().catch(() => {}); server.kill(); }
