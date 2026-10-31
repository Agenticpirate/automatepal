import type {Ticket} from '../../lib/tickets';

/* Shared pieces for the tickets inbox: Lucide (ISC) inline icons, inbox views and display helpers.
   Every number shown in the inbox is computed from the loaded ticket rows; nothing is invented. */

const PATHS = {
  inbox: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>),
  alert: (<><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></>),
  circleDot: (<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></>),
  user: (<><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></>),
  userX: (<><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="m17 17 5 5"/><path d="m22 17-5 5"/></>),
  userPlus: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></>),
  pause: (<><circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/></>),
  check: (<><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></>),
  tick: (<path d="M20 6 9 17l-5-5"/>),
  lifebuoy: (<><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></>),
  search: (<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>),
  plus: (<><path d="M5 12h14"/><path d="M12 5v14"/></>),
  filter: (<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>),
  listChecks: (<><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></>),
  refresh: (<><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></>),
  download: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>),
  link: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>),
  bot: (<><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></>),
  message: (<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>),
  note: (<><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></>),
  arrowUp: (<><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></>),
  chevronDown: (<path d="m6 9 6 6 6-6"/>),
  chevronLeft: (<path d="m15 18-6-6 6-6"/>),
  lock: (<><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>),
  x: (<><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>),
  clipboard: (<><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></>),
};
export type IconName = keyof typeof PATHS;
export function I({n, s = 16, sw = 2}: {n: IconName; s?: number; sw?: number}) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[n]}</svg>;
}

export const isOpenTicket = (t: Ticket) => !['resolved', 'closed'].includes(t.ticket_status);
/* Same rule as the owner overview's "Needs intervention" list, so both pages agree. */
export const needsYou = (t: Ticket) => isOpenTicket(t) && (t.inbox_state === 'attention' || ['high', 'urgent'].includes(t.priority) || ['refund', 'handoff'].includes(t.category));
export const aiPaused = (t: Ticket) => ['taken_over', 'closed'].includes(t.inbox_state);

export const words = (s?: string | null) => (s ?? '').replaceAll('_', ' ');
export const cap = (s?: string | null) => { const w = words(s); return w ? w[0].toUpperCase() + w.slice(1) : ''; };

const STATUS: Record<string, {label: string; dot: string}> = {
  new: {label: 'New', dot: '#2350B5'},
  open: {label: 'Open', dot: '#FD91CC'},
  pending: {label: 'Pending', dot: '#F2B544'},
  in_progress: {label: 'In progress', dot: '#8EA6E0'},
  resolved: {label: 'Resolved', dot: '#22A06B'},
  closed: {label: 'Closed', dot: '#93A3C7'},
};
export const statusMeta = (s: string) => STATUS[s] ?? {label: cap(s), dot: '#93A3C7'};
export const PRIORITY_COLOR: Record<string, string> = {urgent: '#E25FAE', high: '#FD91CC', normal: '#09318D', low: '#C2D1F2'};

export type ViewKey = 'all' | 'attention' | 'open' | 'owner' | 'unassigned' | 'paused' | 'escalations' | 'resolved';
export const VIEWS: {key: ViewKey; label: string; icon: IconName; group: 'Inbox' | 'Queues'; match: (t: Ticket) => boolean}[] = [
  {key: 'all', label: 'All tickets', icon: 'inbox', group: 'Inbox', match: () => true},
  {key: 'attention', label: 'Needs attention', icon: 'alert', group: 'Inbox', match: needsYou},
  {key: 'open', label: 'Open', icon: 'circleDot', group: 'Inbox', match: isOpenTicket},
  {key: 'owner', label: 'Assigned to owner', icon: 'user', group: 'Inbox', match: t => t.assigned_to_owner},
  {key: 'unassigned', label: 'Unassigned', icon: 'userX', group: 'Inbox', match: t => !t.assigned_to_owner},
  {key: 'paused', label: 'AI paused', icon: 'pause', group: 'Queues', match: t => t.inbox_state === 'taken_over'},
  {key: 'escalations', label: 'Escalations only', icon: 'lifebuoy', group: 'Queues', match: t => t.category === 'handoff'},
  {key: 'resolved', label: 'Resolved', icon: 'check', group: 'Queues', match: t => !isOpenTicket(t)},
];

/* "8 min", "3 h", "Yesterday", "4 d", then a date. Used in the ticket list. */
export function shortAgo(ts: string, now: number) {
  const m = Math.max(0, Math.floor((now - Date.parse(ts)) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h';
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return d + ' d';
  return new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
/* "8 min ago", "yesterday", then a date. Used in the conversation thread. */
export function whenLabel(ts: string, now: number) {
  const m = Math.floor((now - Date.parse(ts)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return d + ' days ago';
  return new Date(ts).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}
export function fmtDur(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  const d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

/* Header summary for the list. Uses tickets created in the last 7 days; falls back to all loaded rows. */
export function weekSummary(rows: Ticket[], now: number) {
  const week = rows.filter(t => now - Date.parse(t.created_at) <= 7 * 86400000);
  const base = week.length ? week : rows;
  const resolved = base.filter(t => !isOpenTicket(t)).length;
  const attention = base.filter(needsYou).length;
  const reviews = base.filter(t => t.first_reviewed_at).map(t => Date.parse(t.first_reviewed_at!) - Date.parse(t.created_at)).filter(x => x >= 0).sort((a, b) => a - b);
  const mid = reviews.length >> 1;
  const median = reviews.length ? (reviews.length % 2 ? reviews[mid] : (reviews[mid - 1] + reviews[mid]) / 2) : null;
  return {thisWeek: week.length > 0, total: base.length, resolved, attention, open: base.length - resolved - attention, median};
}
