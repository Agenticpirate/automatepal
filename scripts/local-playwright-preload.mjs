// Lets the existing Playwright verify scripts run on a Mac without editing them:
// - screenshots written to /downloads/* (a sandbox path) go to $SHOTS_DIR (default /tmp/ap-downloads)
// - chromium.launch() uses the installed Google Chrome when Playwright's own Chromium is absent
// Usage: node --import ./scripts/local-playwright-preload.mjs scripts/verify-landing.mjs
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const dir = process.env.SHOTS_DIR || '/tmp/ap-downloads';
const map = p => typeof p === 'string' && p.startsWith('/downloads/') ? path.join(dir, p.slice('/downloads/'.length)) : p;
for (const name of ['writeFile', 'mkdir']) {
  const orig = fs.promises[name].bind(fs.promises);
  fs.promises[name] = (p, ...rest) => orig(name === 'mkdir' && p === '/downloads' ? dir : map(p), ...rest);
}
const origWrite = fs.writeFileSync; fs.writeFileSync = (p, ...rest) => origWrite(map(p), ...rest);
const origMkdir = fs.mkdirSync; fs.mkdirSync = (p, ...rest) => origMkdir(p === '/downloads' ? dir : map(p), ...rest);
fs.mkdirSync(dir, {recursive: true});
if (!process.env.PW_USE_BUNDLED) {
  for (const mod of ['@playwright/test', 'playwright', 'playwright-core']) {
    let m; try { m = require(mod); } catch { continue; }
    const bt = m.chromium; if (!bt || bt.__apPatched) continue;
    const launch = bt.launch.bind(bt);
    bt.launch = (opts = {}) => launch({channel: 'chrome', ...opts});
    bt.__apPatched = true;
  }
}
