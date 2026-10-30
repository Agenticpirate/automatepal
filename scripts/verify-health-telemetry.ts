import assert from'node:assert/strict';
import{healthTelemetry,healthUnavailable}from'../lib/health-telemetry';
function ok(n:string){console.log('PASS',n);}
const groups=[
 {code:'TICKET_READ_FAILED',severity:'error',component:'tickets',count:3,latest:'2026-10-30T10:00:00Z'},
 {code:'OWNER_SNAPSHOT_FAILED',severity:'error',component:'owner',count:1,latest:'2026-10-30T11:00:00Z'},
 {code:'SAFE_RETRY_STARTED',severity:'warning',component:'tickets',count:4,latest:'2026-10-30T09:00:00Z'},
 {code:'SAFE_RETRY_RECOVERED',severity:'info',component:'tickets',count:3,latest:'2026-10-30T09:05:00Z'},
 {code:'SAFE_RETRY_EXHAUSTED',severity:'error',component:'tickets',count:1,latest:'2026-10-30T09:06:00Z'}];
const t=healthTelemetry(groups);
assert.equal(t.events24h,12);
assert.equal(t.errors24h,5);
assert.equal(t.errorRate24h,0.4167);
assert.deepEqual(t.failedJobs24h,{TICKET_READ_FAILED:{count:3,latest:'2026-10-30T10:00:00Z'},OWNER_SNAPSHOT_FAILED:{count:1,latest:'2026-10-30T11:00:00Z'}});
assert.equal(t.autoFix24h.started,4);
assert.equal(t.autoFix24h.recovered,3);
assert.equal(t.autoFix24h.exhausted,1);
assert.equal(t.autoFix24h.recoveryRate,0.75);
assert.equal(t.autoFix24h.log.length,3);
assert.ok(t.autoFix24h.log.every(x=>x.code.startsWith('SAFE_RETRY_')&&x.latest));
ok('telemetry derives error rate, failed jobs, auto-fix log from real groups');
const e=healthTelemetry([]);
assert.equal(e.events24h,0);assert.equal(e.errorRate24h,0);assert.equal(e.autoFix24h.recoveryRate,null);
assert.deepEqual(e.failedJobs24h,{});
ok('empty groups: zero counts, null recovery rate, no division by zero');
const bad=healthTelemetry(null);
assert.equal(bad.events24h,0);
ok('null groups handled');
assert.ok(healthUnavailable.answerLatencyPercentiles.includes('pending owner approval'));
assert.ok(healthUnavailable.quotaUsage.includes('pending owner approval'));
ok('unavailable fields are explicit, never fabricated');
console.log('all health-telemetry checks passed');
