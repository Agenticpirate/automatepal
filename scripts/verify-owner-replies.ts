// Owner replies in the widget (Phase 2): message body validation, merge/dedupe/order, poll cursor, and the
// per-process poll limit (allowRequest with a custom max). No database or network.
import assert from 'node:assert/strict';
import {messageBody, mergeMessages, nextCursor, POLL_MS, type SupportMessage} from '../lib/support-messages';
import {allowRequest} from '../lib/rate-limit';
let n = 0;
const ok = () => { n++; };

// Body: trimmed, 1..1000, control characters stripped except newline, CRLF normalised.
assert.equal(messageBody.parse('  Hello there  '), 'Hello there'); ok();
assert.equal(messageBody.parse('Line 1\r\nLine 2\rLine 3'), 'Line 1\nLine 2\nLine 3'); ok();
assert.equal(messageBody.parse('a\u0000b\u0007c\u001Bd\u007Fe\tf'), 'abcdef'); ok();
assert.equal(messageBody.safeParse('   ').success, false, 'blank'); ok();
assert.equal(messageBody.safeParse('\u0000\u0001').success, false, 'only control chars'); ok();
assert.equal(messageBody.safeParse('x'.repeat(1000)).success, true); ok();
assert.equal(messageBody.safeParse('x'.repeat(1001)).success, false, '1001 chars'); ok();
assert.equal(messageBody.safeParse(42).success, false, 'not a string'); ok();

// Merge: dedupe by id, oldest first, microsecond timestamps from the database keep order.
const m = (id: string, created_at: string, author: SupportMessage['author'] = 'owner', body = id): SupportMessage => ({id, author, body, created_at});
const a = m('a', '2026-11-01T10:00:00.000100+00:00'), b = m('b', '2026-11-01T10:00:00.000900+00:00', 'visitor'), c = m('c', '2026-11-01T10:00:05+00:00');
const merged = mergeMessages([c, a], [b, a]);
assert.deepEqual(merged.map(x => x.id), ['a', 'b', 'c'], 'ordered'); ok();
assert.equal(merged.length, 3, 'deduped'); ok();
assert.equal(mergeMessages([a], [{...a, body: 'edited'}])[0].body, 'edited', 'incoming copy wins'); ok();
assert.deepEqual(mergeMessages([], []), []); ok();

// Cursor: newest created_at as the original string; unchanged when a poll is empty.
assert.equal(nextCursor([a, c, b]), c.created_at); ok();
assert.equal(nextCursor([a, b]), b.created_at, 'microseconds within the same millisecond'); ok();
assert.equal(nextCursor([], c.created_at), c.created_at, 'empty poll keeps cursor'); ok();
assert.equal(nextCursor([a], c.created_at), c.created_at, 'older batch keeps cursor'); ok();
assert.equal(nextCursor([]), null); ok();

// Poll limit: 15 per minute per case token, then refused; other keys unaffected; default max still 6.
const t = 5_000_000;
for (let i = 0; i < 15; i++) assert.equal(allowRequest('poll:fixture', t, 15), true, `poll ${i + 1}`);
ok();
assert.equal(allowRequest('poll:fixture', t, 15), false, '16th refused'); ok();
assert.equal(allowRequest('poll:fixture', t + 60000, 15), true, 'window resets'); ok();
for (let i = 0; i < 6; i++) allowRequest('default:fixture', t);
assert.equal(allowRequest('default:fixture', t), false, 'default max stays 6'); ok();
assert.equal(POLL_MS, 5000); ok();
console.log(`PASS owner replies: ${n} checks (body trim/limits/control chars, merge dedupe + order, microsecond cursor, poll limit 15/min, default limit unchanged)`);
