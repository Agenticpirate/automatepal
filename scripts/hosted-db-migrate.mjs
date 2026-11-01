// Applies pending db/NNN_*.sql migrations to the HOSTED Supabase project, one transaction per file.
// There is no migration ledger, so each migration that creates a table is detected by that table.
//
//   Plan (read-only, default):  DATABASE_PASSWORD_FILE=~/.automatepal/db-password node scripts/hosted-db-migrate.mjs
//   Apply:                       ... node scripts/hosted-db-migrate.mjs --apply --from 043 --to 046 --confirm apply-to-hosted
//
// Apply refuses unless: a backup made by scripts/hosted-db-backup.sh in the last 6 hours exists,
// the migration before --from is detected as applied, and none of --from..--to are detected.
// A failing file rolls back on its own and stops the run; earlier files in the run stay committed.
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = 'aws-0-us-east-1.pooler.supabase.com';
const USER = 'postgres.sknmlhjaysqmtyeqpfiv';
const BACKUP_DIR = path.join(os.homedir(), 'AutomatePal-backups');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');

const pwFile = process.env.DATABASE_PASSWORD_FILE;
if (!pwFile || !fs.existsSync(pwFile)) throw Error('Set DATABASE_PASSWORD_FILE to a chmod 600 file holding the hosted database password.');
if ((fs.statSync(pwFile).mode & 0o077) !== 0) throw Error(`${pwFile} is readable by other users; run chmod 600 on it.`);

const files = fs.readdirSync('db').filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
const marker = (f) => {
  const m = fs.readFileSync(path.join('db', f), 'utf8').match(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/i);
  return m ? m[1] : null;
};

const client = new pg.Client({
  host: HOST, port: 5432, database: 'postgres', user: USER,
  password: fs.readFileSync(pwFile, 'utf8').trim(),
  ssl: {ca: fs.readFileSync('certs/supabase-ca.crt', 'utf8'), rejectUnauthorized: true},
});
await client.connect();
try {
  const status = new Map();
  for (const f of files) {
    const t = marker(f);
    if (!t) { status.set(f, 'unknown (no table)'); continue; }
    const r = await client.query('select to_regclass($1) is not null as present', [`public.${t}`]);
    status.set(f, r.rows[0].present ? `applied (${t})` : `PENDING (${t} missing)`);
  }
  const version = (await client.query('show server_version')).rows[0].server_version;
  console.log(`Hosted Postgres ${version}. Detected state (files 035 and later):`);
  for (const [f, s] of status) if (Number(f.slice(0, 3)) >= 35) console.log(`  ${f.padEnd(36)} ${s}`);
  if (!apply) { console.log('\nPlan only. Nothing changed.'); process.exit(0); }

  if (flag('--confirm') !== 'apply-to-hosted') throw Error('Add --confirm apply-to-hosted to apply.');
  const from = Number(flag('--from')), to = Number(flag('--to'));
  if (!from || !to || to < from) throw Error('Give --from NNN and --to NNN.');
  const recent = fs.existsSync(BACKUP_DIR) && fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .some((f) => Date.now() - fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs < 6 * 3600e3 && fs.statSync(path.join(BACKUP_DIR, f)).size > 0);
  if (!recent) throw Error(`No backup from the last 6 hours in ${BACKUP_DIR}. Run scripts/hosted-db-backup.sh first.`);

  const run = files.filter((f) => Number(f.slice(0, 3)) >= from && Number(f.slice(0, 3)) <= to);
  const before = [...status.keys()].filter((f) => Number(f.slice(0, 3)) < from && marker(f)).pop();
  if (before && !status.get(before).startsWith('applied')) throw Error(`${before} is not applied; refusing to skip ahead.`);
  for (const f of run) if (status.get(f).startsWith('applied')) throw Error(`${f} already looks applied; refusing to replay it.`);

  for (const f of run) {
    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(path.join('db', f), 'utf8'));
      await client.query('COMMIT');
      console.log('applied', f);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('FAILED', f, '(rolled back) -', e.message);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}
