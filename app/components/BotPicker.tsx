'use client';
/* Bot picker for the Widget studio and Setup (db/062). Lists the workspace's bots, remembers the chosen one in
   this browser, and lets managers create, rename and delete bots. Pages read the choice with useSelectedBot()
   and send it as ?bot= / {bot} so settings, install keys and logos apply to that bot. */
import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {authHeaders} from '../../lib/browser-auth';
type Bot = {id: string; name: string; main: boolean; publicKey: string | null; keyActive: boolean};
const KEY = 'ap-bot', EVENT = 'ap-bot-change';
function read(): string { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
function subscribe(cb: () => void) { window.addEventListener(EVENT, cb); window.addEventListener('storage', cb); return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); }; }
/* '' means the Main bot. */
export function useSelectedBot(): string { return useSyncExternalStore(subscribe, read, () => ''); }
export function selectBot(id: string) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage blocked: stays on the Main bot */ } window.dispatchEvent(new Event(EVENT)); }
/* Adds ?bot= (or &bot=) for a non-main bot. */
export const withBot = (url: string, bot: string) => bot ? url + (url.includes('?') ? '&' : '?') + 'bot=' + encodeURIComponent(bot) : url;
export default function BotPicker({onChange}: {onChange?: () => void}) {
  const selected = useSelectedBot();
  const [bots, setBots] = useState<Bot[]>([]), [limit, setLimit] = useState(1), [canManage, setCanManage] = useState(false), [manage, setManage] = useState(false), [name, setName] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch('/api/bots', {headers: await authHeaders()}); if (!r.ok) return;
    const d = await r.json(); setBots(d.bots); setLimit(d.limit); setCanManage(d.canManage);
    // A remembered bot that no longer exists falls back to the Main bot.
    const cur = read(); if (cur && !d.bots.some((b: Bot) => b.id === cur && !b.main)) selectBot('');
  }, []);
  useEffect(() => { void Promise.resolve().then(load).catch(() => {}); }, [load]);
  const current = bots.find(b => (selected ? b.id === selected : b.main));
  async function post(body: object) {
    setBusy(true);
    try { const r = await fetch('/api/bots', {method: 'POST', headers: {'Content-Type': 'application/json', ...await authHeaders()}, body: JSON.stringify(body)}); const d = await r.json(); setNotice(d.note ?? d.error); if (r.ok) { await load(); return d; } return null; }
    finally { setBusy(false); }
  }
  if (bots.length === 0) return null;
  return <section className="ap-dash-card" aria-label="Bot" style={{padding: '12px 16px'}}>
    <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10}}>
      <label className="ap-dash-field" style={{margin: 0, minWidth: 220}}>Bot<select value={current?.main ? '' : current?.id ?? ''} onChange={e => { selectBot(e.target.value); onChange?.(); }} className="ap-dash-select">
        {bots.map(b => <option key={b.id} value={b.main ? '' : b.id}>{b.name}{b.main ? ' (main)' : ''}{b.publicKey ? (b.keyActive ? '' : ' · key off') : ' · not installed'}</option>)}
      </select></label>
      <span className="ap-dash-muted" style={{fontSize: 12}}>{bots.length} of {limit} on your plan. Each bot has its own look, install script and settings.</span>
      {canManage && <button type="button" className="ap-dash-btn ap-dash-btn-ghost" onClick={() => setManage(m => !m)} aria-expanded={manage}>{manage ? 'Done' : 'Manage bots'}</button>}
    </div>
    {manage && <div style={{marginTop: 10, display: 'grid', gap: 8}}>
      {bots.map(b => <BotRowEdit key={b.id} bot={b} busy={busy} onRename={n => post({action: 'rename', id: b.id, name: n})} onDelete={async () => { if (!confirm(`Delete "${b.name}"? Its install script stops working immediately.`)) return; if (await post({action: 'delete', id: b.id}) && selected === b.id) { selectBot(''); onChange?.(); } }}/>)}
      <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end'}}>
        <label className="ap-dash-field" style={{margin: 0}}>New bot name<input value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder="Docs site bot" className="ap-dash-select"/></label>
        <button type="button" className="ap-dash-btn" disabled={busy || !name.trim() || bots.length >= limit} onClick={async () => { const d = await post({action: 'create', name}); if (d?.id) { setName(''); selectBot(d.id); onChange?.(); } }}>Create bot</button>
        {bots.length >= limit && <span className="ap-dash-muted" style={{fontSize: 12}}>Your plan&apos;s limit is reached. Upgrade on the Plan page for more bots.</span>}
      </div>
    </div>}
    {notice && <p role="status" className="ap-dash-muted" style={{margin: '8px 0 0'}}>{notice}</p>}
  </section>;
}
function BotRowEdit({bot, busy, onRename, onDelete}: {bot: Bot; busy: boolean; onRename: (n: string) => void; onDelete: () => void}) {
  const [n, setN] = useState(bot.name);
  return <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center'}}>
    <input aria-label={'Name of ' + bot.name} value={n} maxLength={60} onChange={e => setN(e.target.value)} className="ap-dash-select" style={{maxWidth: 260}}/>
    <button type="button" className="ap-dash-btn ap-dash-btn-ghost" disabled={busy || !n.trim() || n.trim() === bot.name} onClick={() => onRename(n)}>Rename</button>
    {!bot.main && <button type="button" className="ap-dash-btn ap-dash-btn-ghost" disabled={busy} onClick={onDelete}>Delete</button>}
  </div>;
}
