// Redirects the existing DB verify scripts to a LOCAL disposable database without editing them.
// Usage: LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
//        DATABASE_PASSWORD_FILE=/dev/null node --import ./scripts/local-pg-preload.mjs node_modules/.bin/tsx scripts/verify-tickets-db.ts
// Every pg.Client created in the process connects to LOCAL_DATABASE_URL instead of the hosted
// project. Refuses non-local hosts, so it cannot point a script at any shared database.
import {createRequire} from 'node:module';
const url = process.env.LOCAL_DATABASE_URL;
if (url) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw Error(`Refusing non-local database host: ${host}`);
  const require = createRequire(import.meta.url);
  const pg = require('pg');
  const Original = pg.Client;
  class LocalClient extends Original { constructor() { super({connectionString: url}); } }
  pg.Client = LocalClient;
  try { require.cache[require.resolve('pg')].exports.Client = LocalClient; } catch {}
}
