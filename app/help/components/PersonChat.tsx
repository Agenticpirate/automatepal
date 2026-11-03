"use client";
import {modeText} from '../../../lib/app-mode';
import {useCallback, useEffect, useRef, useState} from 'react';
import {mergeMessages, nextCursor, POLL_MS, MESSAGE_MAX, type SupportMessage} from '../../../lib/support-messages';

/* Live thread with a person after the owner takes over (045). The widget polls every POLL_MS while the
   page is visible and stops on an unknown/expired link or a database without the thread RPC. Replies are
   shown here; the team can also email one to an address the visitor shared with consent. */
export function useCaseThread(token: string, enabled: boolean, expiresAt?: string) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [inboxState, setInboxState] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const cursor = useRef<string | null>(null);
  const poll = useCallback(async () => {
    if (expiresAt && Date.now() > Date.parse(expiresAt)) { setStopped(true); return; }
    const r = await fetch('/api/support', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'messages', token, after: cursor.current})});
    if (r.status === 404) { setStopped(true); return; }
    if (!r.ok) return;
    const d = await r.json() as {inboxState: string | null; messages: SupportMessage[]};
    if (d.inboxState === null) { setStopped(true); return; }
    cursor.current = nextCursor(d.messages, cursor.current);
    if (d.messages.length) setMessages(m => mergeMessages(m, d.messages));
    setInboxState(d.inboxState);
  }, [token, expiresAt]);
  useEffect(() => {
    if (!enabled || !token || stopped) return;
    const tick = () => { if (document.visibilityState === 'visible') void poll().catch(() => {}); };
    const first = window.setTimeout(tick, 0), id = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearTimeout(first); window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [enabled, token, stopped, poll]);
  return {messages, inboxState, refresh: poll};
}

export default function PersonChat({token, messages, onSent}: {token: string; messages: SupportMessage[]; onSent: () => void}) {
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return; setBusy(true);
    try {
      const r = await fetch('/api/support', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'visitor_message', token, body: text})});
      const d = await r.json(); setNote(d.note ?? d.error);
      if (r.ok) { setText(''); onSent(); }
    } catch { setNote('Could not send the message.'); } finally { setBusy(false); }
  }
  return <section aria-label="Conversation with a person" className="mb-4 rounded-2xl border border-pink-200 bg-white p-4">
    <h2 className="text-sm font-semibold">Chat with a person</h2>
    <p className="mt-1 text-xs leading-5 text-gray-500">A person from the team has joined. AI answers are paused. Replies appear here.</p>
    {!messages.length && <p className="mt-3 text-xs text-gray-500">Waiting for the team&apos;s first message.</p>}
    <ol className="mt-3 space-y-2">{messages.map(m => <li key={m.id} className={'rounded-xl p-3 text-sm leading-6 ' + (m.author === 'visitor' ? 'ml-8 bg-blue-50' : 'mr-8 bg-pink-50')}>
      <span className="block text-xs font-semibold text-gray-600">{m.author === 'owner' ? 'Team' : 'You'}</span>
      <p className="whitespace-pre-wrap break-words">{m.body}</p>
    </li>)}</ol>
    <form onSubmit={send} className="mt-3 space-y-2">
      <label className="block text-sm">Your reply<textarea value={text} maxLength={MESSAGE_MAX} rows={2} onChange={e => setText(e.target.value)} className="mt-2 block w-full rounded-lg border p-3" placeholder={modeText('Fictional details only','Never share card numbers or passwords')}/></label>
      <button disabled={busy || !text.trim()} className="min-h-11 w-full rounded-lg border p-3 text-sm disabled:opacity-50">{busy ? 'Sending...' : 'Send to the team'}</button>
    </form>
    <p aria-live="polite" className="mt-2 text-xs leading-5 text-gray-600">{note}</p>
  </section>;
}
