// Applies db/NNN_*.sql in numeric order to a LOCAL, disposable database only.
// Usage: LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres node scripts/local-db-apply.mjs [fromNumber]
// Refuses any host other than 127.0.0.1/localhost so it can never touch the hosted project.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
const url = process.env.LOCAL_DATABASE_URL;
if (!url) throw Error('Set LOCAL_DATABASE_URL to the local Supabase database URL.');
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost'].includes(host)) throw Error(`Refusing non-local database host: ${host}`);
const from = Number(process.argv[2] || 1);
const files = fs.readdirSync('db').filter(f => /^\d{3}_.*\.sql$/.test(f)).sort().filter(f => Number(f.slice(0, 3)) >= from);
const client = new pg.Client({connectionString: url});
await client.connect();
// The local Supabase CLI auto-grants ALL on new public tables/functions to anon and authenticated.
// The migrations assume no default access and grant exactly what each object needs, so strip the
// defaults first (local only) to match how the hosted project evaluates them.
if (from === 1) await client.query(`
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;`);
try {
  for (const f of files) {
    const sql = fs.readFileSync(path.join('db', f), 'utf8');
    try { await client.query(sql); console.log('applied', f); }
    catch (e) { console.error('FAILED', f, '-', e.message); process.exitCode = 1; break; }
  }
} finally { await client.end(); }
