'use client';
/* Slack alerts card (db/061): paste an incoming-webhook URL; the URL is never shown again, only its last 4 characters. */
import {useEffect, useState} from 'react';
import {authHeaders} from '../../lib/browser-auth';
type S = {configured: boolean; enabled: boolean; hint: string | null; planAllows: boolean};
export default function SlackSettings() {
  const [s, setS] = useState<S | null>(null), [url, setUrl] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [canEdit, setCanEdit] = useState(false);
  async function read() { const r = await fetch('/api/slack-settings', {headers: await authHeaders()}); const x = await r.json().catch(() => ({})); if (r.ok) { setS(x.settings); setCanEdit(x.canEdit); } }
  useEffect(() => { void Promise.resolve().then(read).catch(() => {}); }, []);
  async function save(next: {url: string | null; enabled?: boolean; test?: boolean}) {
    setBusy(true);
    try { const r = await fetch('/api/slack-settings', {method: 'POST', headers: {...await authHeaders(), 'Content-Type': 'application/json'}, body: JSON.stringify(next)}); const x = await r.json(); setNotice(x.note ?? x.error); if (r.ok) { setUrl(''); await read(); } }
    finally { setBusy(false); }
  }
  if (!canEdit || !s) return null;
  return <section className="ap-dash-card" aria-labelledby="ap-slack-h" style={{marginTop: 16}}>
    <div className="ap-od-cardhead"><h2 id="ap-slack-h" className="ap-dash-h2">Slack alerts</h2><span className={'ap-dash-badge ' + (s.configured && s.enabled ? 'ap-dash-b-ok' : 'ap-dash-b-mut')}>{s.configured ? (s.enabled ? 'On' : 'Off') : 'Not set'}</span></div>
    <p className="ap-dash-muted ap-od-desc">A short message in Slack when a visitor asks for a person, a refund review opens or a lead arrives. No visitor text is sent, only a ticket reference and a link.{!s.planAllows && ' Included from the Growth plan.'}</p>
    {s.configured && <p className="ap-dash-muted">Webhook ending in …{s.hint}</p>}
    <label className="ap-dash-field" style={{marginTop: 8}}>Slack incoming-webhook URL<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" autoComplete="off" className="ap-dash-select"/></label>
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10}}>
      <button type="button" disabled={busy || !url.trim() || !s.planAllows} onClick={() => save({url: url.trim(), enabled: true, test: true})} className="ap-dash-btn">Save and send a test</button>
      {s.configured && <button type="button" disabled={busy} onClick={() => save({url: null})} className="ap-dash-btn ap-dash-btn-ghost">Remove</button>}
    </div>
    <p role="status" className="ap-dash-muted" style={{marginTop: 8}}>{notice}</p>
  </section>;
}
