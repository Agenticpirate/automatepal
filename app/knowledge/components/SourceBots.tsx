'use client';
/* Which bots may answer from a source (db/062). Shown only when the workspace has more than one bot.
   "All bots" (the default) or one specific bot; the database also accepts several. */
import {useEffect, useState} from 'react';
import {authHeaders} from '../../../lib/browser-auth';
type Bot = {id: string; name: string; main: boolean};
let cache: Promise<Bot[]> | null = null;
function loadBots(): Promise<Bot[]> {
  cache ??= authHeaders().then(h => fetch('/api/bots', {headers: h})).then(r => r.ok ? r.json() : {bots: []}).then(d => d.bots as Bot[]).catch(() => { cache = null; return []; });
  return cache;
}
export default function SourceBots({id, value, onSaved, kind = 'source'}: {id: string; value: string[] | null; onSaved: () => void; kind?: 'source' | 'response'}) {
  const [bots, setBots] = useState<Bot[]>([]), [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  useEffect(() => { void loadBots().then(setBots); }, []);
  if (bots.length < 2) return null;
  const current = !value?.length ? '' : value.length === 1 ? value[0] : 'several';
  async function save(v: string) {
    setBusy(true);
    try { const r = await fetch('/api/bots', {method: 'POST', headers: {'Content-Type': 'application/json', ...await authHeaders()}, body: JSON.stringify({action: 'scope', kind, id, bots: v ? [v] : null})}); const d = await r.json(); setMsg(r.ok ? '' : d.error); if (r.ok) onSaved(); }
    finally { setBusy(false); }
  }
  return <label className="ap-dash-muted" style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5}}>Used by
    <select value={current} disabled={busy} onChange={e => void save(e.target.value)} className="ap-dash-select" style={{padding: '5px 8px', fontSize: 11.5, width: 'auto'}}>
      <option value="">All bots</option>
      {current === 'several' && <option value="several" disabled>Several bots</option>}
      {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>{msg && <span role="alert">{msg}</span>}</label>;
}
