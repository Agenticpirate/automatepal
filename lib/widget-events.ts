/* Chat events the /help panel reports to the page that embeds it (public/widget.js re-emits them through
   window.AutomatePal.on and `automatepal:<type>` DOM events). Payloads are a fixed event name plus one fixed
   label: never message text, names, emails, order details or the demo token. */
export type HelpEvent =
  | {event: 'message_sent'; channel: 'ai' | 'person' | 'request'}
  | {event: 'handoff_requested'; withinHours: boolean}
  | {event: 'lead_submitted'};
export const HELP_EVENT_SOURCE = 'automatepal-help';
// The embedding page's origin, passed by widget.js as ?embed=<origin>. Anything that is not a bare http(s)
// origin is ignored, so events are only ever posted to one exact origin.
export function embedOrigin(value: string | null): string | null {
  if (!value || value.length > 200) return null;
  try { const u = new URL(value); return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === value ? value : null; } catch { return null; }
}
export function helpEventMessage(e: HelpEvent): Record<string, unknown> {
  if (e.event === 'message_sent') return {source: HELP_EVENT_SOURCE, event: e.event, channel: e.channel};
  if (e.event === 'handoff_requested') return {source: HELP_EVENT_SOURCE, event: e.event, withinHours: e.withinHours};
  return {source: HELP_EVENT_SOURCE, event: e.event};
}
export function postHelpEvent(origin: string | null, e: HelpEvent) {
  if (!origin || typeof window === 'undefined' || window.parent === window) return;
  try { window.parent.postMessage(helpEventMessage(e), origin); } catch { /* a closed or cross-origin parent is fine */ }
}
