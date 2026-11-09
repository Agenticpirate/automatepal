'use client';
/* Notifications on this device (db/063): the browser's Web Push, so a phone or computer is told when a visitor
   asks for a person, a refund review opens or a lead arrives, even when AutomatePal is closed. On iPhone and
   iPad, add AutomatePal to the Home Screen first (Safari › Share › Add to Home Screen) and open it from there. */
import {useCallback, useEffect, useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
type Device = {id: string; label: string | null; created_at: string; last_success_at: string | null};
const keyBytes = (b64u: string) => { const t = b64u.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(t + '='.repeat((4 - t.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); };
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${br}`;
}
export default function PushSettings() {
  const [state, setState] = useState<{available: boolean; publicKey: string | null; devices: Device[]} | null>(null);
  const [supported, setSupported] = useState(true), [iosNeedsInstall, setIosNeedsInstall] = useState(false), [subscribed, setSubscribed] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const r = await fetch('/api/push', {headers: await authHeaders()}); if (r.ok) setState(await r.json());
    if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration('/'); setSubscribed(!!(await reg?.pushManager.getSubscription())); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setSupported('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
      const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & {standalone?: boolean}).standalone === true;
      setIosNeedsInstall(ios && !standalone);
      return load();
    }).catch(() => {});
  }, [load]);
  async function post(body: object) { const r = await fetch('/api/push', {method: 'POST', headers: {'Content-Type': 'application/json', ...await authHeaders()}, body: JSON.stringify(body)}); const d = await r.json(); setNotice(d.note ?? d.error); return r.ok; }
  async function enable() {
    if (!state?.publicKey) return;
    setBusy(true);
    try {
      if (await Notification.requestPermission() !== 'granted') { setNotice('Notifications are blocked for this site. Allow them in your browser settings, then try again.'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js', {scope: '/'}); await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey)});
      const j = sub.toJSON() as {endpoint: string; keys: {p256dh: string; auth: string}};
      if (await post({action: 'subscribe', endpoint: j.endpoint, keys: j.keys, label: deviceLabel()})) await load();
    } catch { setNotice('This browser could not turn on notifications. Try again, or use another browser.'); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true);
    try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = await reg?.pushManager.getSubscription(); if (sub) { await post({action: 'unsubscribe', endpoint: sub.endpoint}); await sub.unsubscribe(); } await load(); }
    finally { setBusy(false); }
  }
  if (!state) return null;
  return <section className="ap-dash-card" aria-labelledby="ap-push-h" style={{marginTop: 16}}>
    <div className="ap-od-cardhead"><h2 id="ap-push-h" className="ap-dash-h2">Notifications on this device</h2><span className={'ap-dash-badge ' + (subscribed ? 'ap-dash-b-ok' : 'ap-dash-b-mut')}>{subscribed ? 'On' : 'Off'}</span></div>
    <p className="ap-dash-muted ap-od-desc">Get a notification on this phone or computer when a visitor asks for a person, a refund review opens or a lead arrives, even when AutomatePal is closed. Tap it to open the ticket. No visitor text is shown.</p>
    {!state.available ? <p className="ap-dash-muted">Push is not set up on this server yet.</p>
      : !supported ? <p className="ap-dash-muted">This browser does not support notifications.</p>
      : iosNeedsInstall ? <p className="ap-dash-note-warn">On iPhone and iPad: in Safari tap Share › Add to Home Screen, open AutomatePal from the new icon, then turn notifications on here.</p>
      : <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8}}>
        {subscribed ? <><button type="button" className="ap-dash-btn" disabled={busy} onClick={() => void post({action: 'test'})}>Send a test</button><button type="button" className="ap-dash-btn ap-dash-btn-ghost" disabled={busy} onClick={disable}>Turn off on this device</button></>
          : <button type="button" className="ap-dash-btn" disabled={busy} onClick={enable}>Turn on notifications</button>}
      </div>}
    {state.devices.length > 0 && <><h3 className="ap-dash-h2" style={{fontSize: 14, marginTop: 12}}>Your devices</h3><ul className="ap-od-queue">{state.devices.map(d => <li key={d.id}><span>{d.label ?? 'Device'}</span><span className="ap-dash-muted">{d.last_success_at ? 'last notified ' + new Date(d.last_success_at).toLocaleDateString() : 'added ' + new Date(d.created_at).toLocaleDateString()}</span></li>)}</ul></>}
    <p role="status" className="ap-dash-muted" style={{marginTop: 8}}>{notice}</p>
  </section>;
}
