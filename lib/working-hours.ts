import {z} from 'zod';
/* Working hours for the person-handoff path. Outside these hours the visitor sees the away message and
   their request is saved for the team. Disabled (the default) means a person can always be asked. */
export const DEFAULT_AWAY_MESSAGE = 'We are away right now. Leave your question and the team will reply when they are back.';
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
export const validTimeZone = (tz: string) => { try { new Intl.DateTimeFormat('en', {timeZone: tz}); return true; } catch { return false; } };
export const workingHours = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().min(1).max(64).refine(validTimeZone, 'Unknown time zone'),
  days: z.array(z.object({day: z.number().int().min(0).max(6), start: hhmm, end: hhmm})).max(14).default([]),
  awayMessage: z.string().trim().max(300).default(DEFAULT_AWAY_MESSAGE),
});
export type WorkingHours = z.infer<typeof workingHours>;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY: Record<string, number> = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/* Local weekday and minute of day in the given zone. */
export function zonedClock(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return {day: WEEKDAY[get('weekday')] ?? 0, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute'))};
}
/* Open when the local time falls in a range for today, or in an overnight range (end <= start) that began
   yesterday. start == end is treated as a full 24 hours from start. Disabled or missing means always open. */
export function isOpenNow(h: WorkingHours | null | undefined, now: Date = new Date()): boolean {
  if (!h || !h.enabled) return true;
  if (!validTimeZone(h.timezone)) return true;
  const {day, minute} = zonedClock(h.timezone, now);
  const yesterday = (day + 6) % 7;
  return h.days.some(r => {
    const s = minutes(r.start), e = minutes(r.end);
    if (e > s) return r.day === day && minute >= s && minute < e;
    return (r.day === day && minute >= s) || (r.day === yesterday && minute < e);
  });
}
