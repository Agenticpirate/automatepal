import {z} from 'zod';import './zod-csp';
/* Owner-defined follow-up suggestions, shown as buttons after an answer in the widget. Deterministic: the
   owner's order, minus duplicates and the question just asked, first FOLLOW_UP_SHOWN only. Plain text only
   (rendered as React text, and angle brackets and control characters are refused when saved). */
export const FOLLOW_UP_MAX = 6;
export const FOLLOW_UP_SHOWN = 3;
export const FOLLOW_UP_CHARS = 80;
export const followUpText = z.string().trim().min(3).max(FOLLOW_UP_CHARS).regex(/^[^<>\u0000-\u001F\u007F]*$/, 'Plain text only: no angle brackets or control characters');
export const followUpList = z.array(followUpText).max(FOLLOW_UP_MAX);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function followUpsFor(list: unknown, asked: string): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set([norm(asked)]), out: string[] = [];
  for (const raw of list.slice(0, FOLLOW_UP_MAX)) {
    const p = followUpText.safeParse(raw);
    if (!p.success) continue;
    const k = norm(p.data);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(p.data);
    if (out.length === FOLLOW_UP_SHOWN) break;
  }
  return out;
}
