/* Import Markdown docs from a public GitHub repository (Phase 3). Lists the repository tree through the GitHub
   REST API and fetches .md, .mdx, .markdown and .txt files from raw.githubusercontent.com, each through the
   SSRF-safe safeGet (resolved and checked addresses, size and time caps). Only those two GitHub hosts are
   contacted. Returns pages in the crawler's shape (lib/crawl.ts), so they go to the owner's review list and
   are saved only through the existing consent path. No token: public repositories only (GitHub allows 60
   unauthenticated API requests per hour per IP; one import uses one). */
import {safeGet, ImportFetchError, type SafeGetOptions} from './url-import';
import type {CrawlResult, CrawledPage, SkippedPage} from './crawl';
export const GITHUB_MAX_FILES = 50;
const PAGE_CHARS = 30000;
const DOC = /\.(md|mdx|markdown|txt)$/i;
export type GithubRepo = {owner: string; repo: string; ref: string | null; path: string};
/* https://github.com/owner/repo, …/tree/<ref>/<path>, or owner/repo. */
export function parseGithubRepo(raw: string): GithubRepo | null {
  const s = raw.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const short = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  if (short) return {owner: short[1], repo: short[2], ref: null, path: ''};
  let u: URL; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2 || !/^[A-Za-z0-9-]{1,39}$/.test(parts[0]) || !/^[A-Za-z0-9._-]{1,100}$/.test(parts[1])) return null;
  if (parts.length === 2) return {owner: parts[0], repo: parts[1], ref: null, path: ''};
  if (parts[2] !== 'tree' && parts[2] !== 'blob' || parts.length < 4) return null;
  const ref = parts[3];
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(ref)) return null;
  return {owner: parts[0], repo: parts[1], ref, path: parts.slice(4).join('/')};
}
const titleOf = (md: string, file: string) => (/^#\s+(.+)$/m.exec(md)?.[1] ?? file.split('/').pop()!.replace(DOC, '').replace(/[-_]+/g, ' ')).trim().slice(0, 120);
// Drop front matter and HTML comments; keep Markdown as written.
export const cleanMarkdown = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
export async function importGithubDocs(r: GithubRepo, o: {maxFiles?: number; skipUrls?: string[]; deadline?: number; get?: typeof safeGet; getOpts?: SafeGetOptions} = {}): Promise<CrawlResult> {
  const get = o.get ?? safeGet, max = Math.min(o.maxFiles ?? 20, GITHUB_MAX_FILES), deadline = o.deadline ?? Date.now() + 45_000;
  const headers = {Accept: 'application/vnd.github+json', 'User-Agent': 'AutomatePal-docs-import', 'X-GitHub-Api-Version': '2022-11-28'};
  const tree = await get(`https://api.github.com/repos/${r.owner}/${r.repo}/git/trees/${encodeURIComponent(r.ref ?? 'HEAD')}?recursive=1`, {...o.getOpts, headers, maxBytes: 2_000_000, deadline});
  if (tree.status === 404) throw new ImportFetchError('Repository or branch not found. Only public repositories can be imported.', 404);
  if (tree.status === 403 || tree.status === 429) throw new ImportFetchError('GitHub is limiting requests right now. Try again in an hour.', 429);
  if (tree.status !== 200) throw new ImportFetchError('GitHub did not return the repository files.', 502);
  let items: {path: string; type: string; size?: number}[];
  try { items = (JSON.parse(tree.body).tree ?? []) as typeof items; } catch { throw new ImportFetchError('GitHub returned an unexpected response.', 502); }
  const prefix = r.path ? r.path.replace(/\/+$/, '') + '/' : '';
  const skip = new Set(o.skipUrls ?? []);
  const ref = r.ref ?? 'HEAD';
  const files = items.filter(i => i.type === 'blob' && DOC.test(i.path) && (!prefix || i.path.startsWith(prefix) || i.path === r.path) && (i.size ?? 0) <= 300_000 && !/(^|\/)(node_modules|vendor|\.github)\//.test(i.path) && !/(^|\/)(CHANGELOG|LICENSE|CODE_OF_CONDUCT)(\.|$)/i.test(i.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  const pages: CrawledPage[] = [], skipped: SkippedPage[] = [];
  let stoppedBy: string | undefined;
  for (const f of files) {
    if (pages.length >= max) { stoppedBy = 'page limit'; break; }
    if (Date.now() > deadline - 3_000) { stoppedBy = 'time limit'; break; }
    const view = `https://github.com/${r.owner}/${r.repo}/blob/${ref}/${f.path}`;
    if (skip.has(view)) continue;
    try {
      const res = await get(`https://raw.githubusercontent.com/${r.owner}/${r.repo}/${encodeURIComponent(ref)}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {...o.getOpts, maxBytes: 300_000, deadline});
      if (res.status !== 200) { skipped.push({url: view, reason: `HTTP ${res.status}`}); continue; }
      const md = cleanMarkdown(res.body).slice(0, PAGE_CHARS);
      if (md.length < 40) { skipped.push({url: view, reason: 'too short'}); continue; }
      pages.push({url: view, title: titleOf(md, f.path), markdown: md, chars: md.length, pageUnits: Math.ceil(md.length / 2500), via: 'html'});
    } catch { skipped.push({url: view, reason: 'could not fetch'}); }
  }
  return {pages, skipped, discovered: files.length, truncated: files.length > pages.length + skipped.length, ...(stoppedBy ? {stoppedBy} : {})};
}
