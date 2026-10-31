#!/bin/zsh
# Rebuilds the LOCAL disposable Supabase database: reset, apply db/001..N, seed two synthetic users.
# Local only (scripts refuse non-local hosts). Never run against the hosted project.
set -e
cd "$(dirname "$0")/.."
export LOCAL_DATABASE_URL=${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
[[ -z "$DOCKER_HOST" && -S "$HOME/.colima/default/docker.sock" ]] && export DOCKER_HOST=unix://$HOME/.colima/default/docker.sock
npx -y supabase@latest db reset --local --workdir .supabase-local >/dev/null 2>&1
for i in {1..30}; do node -e "const pg=require('pg');const c=new pg.Client({connectionString:process.env.LOCAL_DATABASE_URL});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))" && break; sleep 1; done
node scripts/local-db-apply.mjs | tail -1
node -e "
const pg=require('pg');const c=new pg.Client({connectionString:process.env.LOCAL_DATABASE_URL});
(async()=>{await c.connect();
for(const [id,email,ago] of [['00000000-0000-4000-8000-000000000001','owner.fixture@example.test','2 days'],['00000000-0000-4000-8000-000000000002','second.fixture@example.test','1 day']])
 await c.query(\"insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(\$1::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',\$2::text,now(),'{}','{}',now()-\$3::interval,now())\",[id,email,ago]);
await c.end();console.log('seeded 2 synthetic users');})()"
