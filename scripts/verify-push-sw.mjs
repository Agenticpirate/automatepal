// Real browser check of the push service worker (public/sw.js) against a LOCAL app: registers it, delivers
// push messages through Chromium's DevTools protocol (no push service needed), and reads the notifications it
// shows. Also checks the web app manifest (standalone, opens Tickets) and the worker's no-cache header.
// Usage (app running locally): E2E_APP=http://localhost:3100 node scripts/verify-push-sw.mjs
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const APP = process.env.E2E_APP;
if (!APP || !['127.0.0.1', 'localhost'].includes(new URL(APP).hostname)) { console.error('Set E2E_APP to a local app URL.'); process.exit(1); }
let n = 0;
const ok = () => { n++; };
// The full Chromium build (headless) supports notifications; the lightweight headless shell denies them.
const browser = await chromium.launch({channel: 'chromium'});
try {
  const sw = await fetch(APP + '/sw.js');
  assert.equal(sw.status, 200); assert.match(sw.headers.get('cache-control') ?? '', /no-cache/); assert.match(sw.headers.get('content-type') ?? '', /javascript/); ok();
  const manifest = await (await fetch(APP + '/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.start_url, '/tickets'); ok();
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['notifications'], {origin: APP});
  const page = await ctx.newPage();
  await page.goto(APP + '/pricing');
  const cdp = await ctx.newCDPSession(page);
  const regId = new Promise(res => cdp.on('ServiceWorker.workerRegistrationUpdated', e => { const r = e.registrations.find(x => x.scopeURL === APP + '/' && !x.isDeleted); if (r) res(r.registrationId); }));
  await cdp.send('ServiceWorker.enable');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', {scope: '/'}); await navigator.serviceWorker.ready; });
  const registrationId = await regId; ok();
  const deliver = async (data) => cdp.send('ServiceWorker.deliverPushMessage', {origin: APP, registrationId, data: JSON.stringify(data)});
  const notes = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(x => ({title: x.title, body: x.body, url: x.data && x.data.url, tag: x.tag})));
  const waitTag = async (tag, count = 1) => { for (let i = 0; i < 40; i++) { if ((await notes()).filter(x => x.tag === tag).length >= count) return; await page.waitForTimeout(250); } throw Error('no notification with tag ' + tag); };
  await deliver({title: 'A visitor asked for a person', body: 'T-1234 · tap to open', url: '/tickets?ticket=11111111-2222-4333-8444-555555555555', tag: 'case-1'});
  await waitTag('case-1');
  let shown = await notes();
  assert.equal(shown[0].title, 'A visitor asked for a person'); assert.equal(shown[0].url, '/tickets?ticket=11111111-2222-4333-8444-555555555555'); ok();
  // A link to another site is never opened: it falls back to Tickets.
  await deliver({title: 'Odd', url: '//evil.example/x', tag: 'case-2'});
  await waitTag('case-2');
  shown = await notes();
  assert.equal(shown.find(x => x.tag === 'case-2')?.url, '/tickets', JSON.stringify(shown)); ok();
  // Same tag replaces the earlier notification instead of stacking.
  await deliver({title: 'A visitor asked for a person', body: 'again', url: '/tickets', tag: 'case-1'});
  await page.waitForTimeout(500);
  assert.equal((await notes()).filter(x => x.tag === 'case-1').length, 1); ok();
  console.log(`PASS push service worker: ${n} checks; worker served with no-cache, standalone manifest opening Tickets, registered in Chromium, push messages shown as notifications with the ticket link, links to other sites fall back to Tickets, same ticket replaces its notification.`);
} finally { await browser.close(); }
