// Working hours + away message (Phase 2): zone-aware open/closed, DST boundary, overnight ranges,
// disabled = always open, validation, backwards-compatible widget settings, 8000-byte controls cap.
import assert from 'node:assert/strict';
import {isOpenNow, workingHours, DEFAULT_AWAY_MESSAGE, type WorkingHours} from '../lib/working-hours';
import {widgetSettings} from '../lib/widget';
let n = 0;
const ok = () => { n++; };
const weekdays = (start: string, end: string) => [1, 2, 3, 4, 5].map(day => ({day, start, end}));
const h = (timezone: string, days: WorkingHours['days'], enabled = true): WorkingHours => workingHours.parse({enabled, timezone, days});
const at = (iso: string) => new Date(iso);

// Asia/Kolkata (UTC+5:30, no DST), Mon-Fri 09:00-18:00.
const ist = h('Asia/Kolkata', weekdays('09:00', '18:00'));
assert.equal(isOpenNow(ist, at('2026-11-02T03:30:00Z')), true, 'Mon 09:00 IST open'); ok();
assert.equal(isOpenNow(ist, at('2026-11-02T03:29:00Z')), false, 'Mon 08:59 IST closed'); ok();
assert.equal(isOpenNow(ist, at('2026-11-02T12:29:00Z')), true, 'Mon 17:59 IST open'); ok();
assert.equal(isOpenNow(ist, at('2026-11-02T12:30:00Z')), false, 'Mon 18:00 IST closed (end exclusive)'); ok();
assert.equal(isOpenNow(ist, at('2026-11-01T06:00:00Z')), false, 'Sunday IST closed'); ok();
// Same instant is Sunday evening in New York (closed) and Monday morning in Kolkata (open).
const ny = h('America/New_York', weekdays('09:00', '17:00'));
assert.equal(isOpenNow(ny, at('2026-11-02T03:30:00Z')), false, 'Sun 22:30 EST closed'); ok();
assert.equal(isOpenNow(ny, at('2026-11-02T14:00:00Z')), true, 'Mon 09:00 EST open'); ok();
assert.equal(isOpenNow(ny, at('2026-11-02T13:59:00Z')), false, 'Mon 08:59 EST closed'); ok();
// DST: US clocks fall back on Sun 2026-11-01 at 02:00 EDT. Mon 09:00 local is 14:00Z after, 13:00Z before.
assert.equal(isOpenNow(ny, at('2026-10-26T13:00:00Z')), true, 'Mon 09:00 EDT (UTC-4) open before DST end'); ok();
assert.equal(isOpenNow(ny, at('2026-11-02T13:00:00Z')), false, 'same UTC time is 08:00 EST after DST end'); ok();
// DST day itself: a Sunday 01:00-03:00 range; 01:30 occurs twice and both count as open.
const dstDay = h('America/New_York', [{day: 0, start: '01:00', end: '03:00'}]);
assert.equal(isOpenNow(dstDay, at('2026-11-01T05:30:00Z')), true, '01:30 EDT open'); ok();
assert.equal(isOpenNow(dstDay, at('2026-11-01T06:30:00Z')), true, '01:30 EST (repeated hour) open'); ok();
assert.equal(isOpenNow(dstDay, at('2026-11-01T08:00:00Z')), false, '03:00 EST closed'); ok();

// Overnight 22:00-02:00 on Friday covers Fri 22:00 to Sat 01:59 local.
const night = h('Asia/Kolkata', [{day: 5, start: '22:00', end: '02:00'}]);
assert.equal(isOpenNow(night, at('2026-11-06T16:30:00Z')), true, 'Fri 22:00 IST open'); ok();
assert.equal(isOpenNow(night, at('2026-11-06T20:00:00Z')), true, 'Sat 01:30 IST open from Friday'); ok();
assert.equal(isOpenNow(night, at('2026-11-06T20:30:00Z')), false, 'Sat 02:00 IST closed'); ok();
assert.equal(isOpenNow(night, at('2026-11-06T16:00:00Z')), false, 'Fri 21:30 IST closed'); ok();
assert.equal(isOpenNow(night, at('2026-11-07T20:00:00Z')), false, 'Sun 01:30 IST closed (no Saturday range)'); ok();

// Disabled or missing means always open.
assert.equal(isOpenNow(h('Asia/Kolkata', [], false), at('2026-11-01T06:00:00Z')), true); ok();
assert.equal(isOpenNow(undefined), true); ok();
assert.equal(isOpenNow(h('Asia/Kolkata', []), at('2026-11-02T06:00:00Z')), false, 'enabled with no ranges is closed'); ok();

// Validation.
assert.equal(workingHours.safeParse({enabled: true, timezone: 'Mars/Olympus', days: []}).success, false, 'invalid zone'); ok();
for (const bad of ['9:00', '24:00', '12:60', '12-00', '']) { assert.equal(workingHours.safeParse({enabled: true, timezone: 'UTC', days: [{day: 1, start: bad, end: '10:00'}]}).success, false, `bad HH:MM ${bad}`); ok(); }
assert.equal(workingHours.safeParse({enabled: true, timezone: 'UTC', days: [{day: 7, start: '09:00', end: '10:00'}]}).success, false, 'day 7'); ok();
assert.equal(workingHours.safeParse({enabled: true, timezone: 'UTC', days: Array.from({length: 15}, () => ({day: 1, start: '09:00', end: '10:00'}))}).success, false, '15 ranges'); ok();
assert.equal(workingHours.safeParse({enabled: true, timezone: 'UTC', days: [], awayMessage: 'x'.repeat(301)}).success, false, 'away > 300'); ok();
assert.equal(workingHours.parse({timezone: 'UTC'}).awayMessage, DEFAULT_AWAY_MESSAGE, 'default away message'); ok();
assert.equal(workingHours.parse({timezone: 'UTC'}).enabled, false, 'default disabled'); ok();

// Old settings without the new keys still parse; visitor choice defaults on.
const base = {label: 'Help', color: '#233de8', initials: 'AP', prompts: [], allowedOrigins: [], excludedPaths: [], autoOpen: false, side: 'right', hideSources: false, hideOrder: false, hideContact: false};
const old = widgetSettings.parse(base);
assert.equal(old.workingHours, undefined); assert.equal(old.visitorChoice, true); ok();
assert.equal(widgetSettings.safeParse({...base, workingHours: {enabled: true, timezone: 'Nowhere/Zone', days: []}}).success, false, 'settings reject bad zone'); ok();

// 14 ranges with a 300-character away message and six 80-character follow-ups fit the 8000-byte controls cap (db/023 CHECK).
const full = widgetSettings.parse({...base, allowedOrigins: Array.from({length: 10}, (_, i) => `https://shop-${i}.merchant-example.com`), excludedPaths: Array.from({length: 20}, (_, i) => '/account/section-' + i), workingHours: {enabled: true, timezone: 'America/Argentina/ComodRivadavia', days: Array.from({length: 14}, (_, i) => ({day: i % 7, start: '09:00', end: '17:30'})), awayMessage: 'é'.repeat(300)}, followUps: Array.from({length: 6}, (_, i) => i + 'é'.repeat(79))});
const {label, color, initials, prompts, ...controls} = full; void label; void color; void initials; void prompts;
const bytes = Buffer.byteLength(JSON.stringify(controls));
assert.ok(bytes <= 8000, `controls ${bytes} bytes`); ok();
console.log(`PASS working hours: ${n} checks (Kolkata + New York open/closed, DST end + repeated hour, overnight 22:00-02:00, disabled always open, invalid zone/HH:MM/day/count rejected, old settings parse, 14 ranges + 6 follow-ups = ${bytes} of 8000 bytes)`);
