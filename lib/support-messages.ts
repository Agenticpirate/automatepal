import {z} from 'zod';
/* Owner replies in the widget (045). Messages are shown live in the widget only; nothing is emailed. */
export const POLL_MS = 5000;
export const MESSAGE_MAX = 1000;
// Control characters except newline (\n) are stripped; carriage returns are normalised to newlines first.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
export const messageBody = z.string().transform(s => s.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim()).pipe(z.string().min(1).max(MESSAGE_MAX));
export type SupportMessage = {id: string; author: 'owner' | 'visitor'; body: string; created_at: string};
/* Merge a polled batch into the current thread: dedupe by id (newer copy wins), oldest first. */
export function mergeMessages(current: SupportMessage[], incoming: SupportMessage[]): SupportMessage[] {
  const byId = new Map<string, SupportMessage>();
  for (const m of [...current, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
/* Cursor for the next poll: the newest created_at string as returned by the database (keeps microseconds). */
export function nextCursor(messages: SupportMessage[], previous: string | null = null): string | null {
  let best = previous;
  for (const m of messages) if (!best || Date.parse(m.created_at) > Date.parse(best) || (Date.parse(m.created_at) === Date.parse(best) && m.created_at > best)) best = m.created_at;
  return best;
}
