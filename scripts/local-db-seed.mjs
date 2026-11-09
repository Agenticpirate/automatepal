// Seeds the two synthetic auth users the DB suites expect. LOCAL ONLY (refuses non-local hosts).
// Used by scripts/local-db-reset.sh and the CI workflow.
import pg from 'pg';
const url = process.env.LOCAL_DATABASE_URL;
if (!url) throw Error('Set LOCAL_DATABASE_URL to the local Supabase database URL.');
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw Error('Refusing non-local database host');
const c = new pg.Client({connectionString: url});
await c.connect();
try {
  for (const [id, email, ago] of [
    ['00000000-0000-4000-8000-000000000001', 'owner.fixture@example.test', '2 days'],
    ['00000000-0000-4000-8000-000000000002', 'second.fixture@example.test', '1 day'],
  ]) {
    await c.query("insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2::text,now(),'{}','{}',now()-$3::interval,now()) on conflict (id) do nothing", [id, email, ago]);
  }
  console.log('seeded 2 synthetic users');
} finally { await c.end(); }
