/* Cloudflare Worker entry: the OpenNext-generated Next.js handler plus a Cron Trigger.
   wrangler.jsonc points `main` here. The scheduled handler sends the same authenticated POST the GitHub
   workflow used to send to /api/cron/refresh, but straight into this Worker's own fetch handler, so it
   never leaves Cloudflare and needs no public URL. All bounds and auth stay in that route (lib/cron.ts). */
// .open-next/worker.js only exists after `opennextjs-cloudflare build`, so the import may or may not resolve.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import {default as handler} from './.open-next/worker.js';

type Env = {APP_URL?: string; CRON_SECRET?: string} & Record<string, unknown>;
type Ctx = {waitUntil(p: Promise<unknown>): void};
type Controller = {cron: string; scheduledTime: number};

export default {
  fetch: handler.fetch,
  async scheduled(controller: Controller, env: Env, ctx: Ctx) {
    if (!env.CRON_SECRET || !env.APP_URL) {
      console.log(JSON.stringify({event: 'cron_skipped', reason: 'CRON_SECRET or APP_URL not set', cron: controller.cron}));
      return;
    }
    const req = new Request(new URL('/api/cron/refresh', env.APP_URL), {
      method: 'POST',
      headers: {Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json'},
    });
    const run = (async () => {
      const res: Response = await handler.fetch(req, env, ctx);
      // The route answers with counts only, so the body is safe to log.
      console.log(JSON.stringify({event: 'cron_run', cron: controller.cron, status: res.status, body: (await res.text()).slice(0, 2000)}));
    })();
    ctx.waitUntil(run);
    await run;
  },
};
