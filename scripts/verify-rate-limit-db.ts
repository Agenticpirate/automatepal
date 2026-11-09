// db/054 shared rate limit: counting, window, input checks and role grants. Rollback only.
// LOCAL ONLY: requires LOCAL_DATABASE_URL on 127.0.0.1/localhost.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Client} from 'pg';
const local = process.env.LOCAL_DATABASE_URL;
if (!local) { console.error('verify-rate-limit-db: set LOCAL_DATABASE_URL to the local Supabase database (refusing to run without it).'); process.exit(1); }
if (!['127.0.0.1', 'localhost'].includes(new URL(local).hostname)) { console.error('verify-rate-limit-db: refusing non-local host'); process.exit(1); }
const c = new Client({connectionString: local});
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const ok = () => { n++; };
const hit = async (key: string, max: number, win = 60) => (await c.query('select rate_limit_hit($1,$2,$3) r', [key, max, win])).rows[0].r as boolean;
async function rejects(sql: string, args: unknown[], match: RegExp) {
  await c.query('SAVEPOINT x');
  await assert.rejects(() => c.query(sql, args), (e: Error) => match.test(e.message) || (console.error('unexpected error:', e.message), false));
  await c.query('ROLLBACK TO SAVEPOINT x');
  ok();
}
async function main() {
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE service_role');
    const k = sha('fixture:' + Date.now());
    for (let i = 1; i <= 3; i++) { assert.equal(await hit(k, 3), true, `hit ${i} allowed`); ok(); }
    assert.equal(await hit(k, 3), false, '4th refused'); ok();
    assert.equal(await hit(k, 3), false, '5th still refused'); ok();
    assert.equal(await hit(sha('other'), 3), true, 'other key independent'); ok();
    const row = (await c.query('select hits from rate_limit_counters where key_hash=$1', [k])).rows;
    assert.equal(row.length, 1); assert.equal(row[0].hits, 5, 'one row, five hits'); ok();
    await rejects('select rate_limit_hit($1,3,60)', ['not-a-hash'], /invalid key/);
    await rejects('select rate_limit_hit($1,0,60)', [k], /invalid max/);
    await rejects('select rate_limit_hit($1,3,0)', [k], /invalid window/);
    await rejects('select rate_limit_hit($1,3,7200)', [k], /invalid window/);
    for (const role of ['anon', 'authenticated']) {
      await c.query('RESET ROLE'); await c.query(`SET LOCAL ROLE ${role}`);
      await rejects('select rate_limit_hit($1,3,60)', [k], /permission denied/);
      await rejects('select * from rate_limit_counters', [], /permission denied/);
    }
    console.log(`verify-rate-limit-db: ${n} checks passed (rolled back)`);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
