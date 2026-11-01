// Vendors a pruned subset of a payment provider's published API contract for hermetic tests.
// Usage: node scripts/billing-specs/vendor.mjs <provider> [--check]
// Network is used only here (once per provider). Tests read the JSON this writes and never fetch.
// Full upstream files are NOT stored: subset.json + pinned commit + upstream sha256 is reproducible,
// and --check re-downloads the pinned file(s) and confirms the recorded hash.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);

const GH = (repo, commit, file) => `https://raw.githubusercontent.com/${repo}/${commit}/${file}`;
// Pins come from the Sources table in .agents/tasks/automatepal-business-support/plan.md.
const SOURCES = {
  paypal: {kind: 'github', repo: 'paypal/paypal-rest-api-specifications', commit: '90e8041ffe02d80c452d2b476bedd59a8d219bdc', commitDate: '2026-04-07T22:49:49Z',
    files: ['openapi/checkout_orders_v2.json', 'openapi/payments_payment_v2.json', 'openapi/invoicing_v2.json', 'openapi/billing_subscriptions_v1.json'],
    license: 'Apache-2.0', licenseFiles: ['LICENSE'], confidence: 'official-spec',
    notes: 'POST /v1/oauth2/token (client-credentials auth exchange) is documented at developer.paypal.com/api/rest/authentication/ and is not an operation in these spec files; it is allowlisted as the named auth exchange only.'},
  stripe: {kind: 'github', repo: 'stripe/openapi', commit: '51610f5f061c9723730582a7638b8cc0e646640d', commitDate: '2026-10-29T22:36:39Z',
    files: ['openapi/spec3.json'], license: 'MIT', licenseFiles: ['LICENSE'], confidence: 'official-spec', notes: 'Stripe-Version is pinned to info.version of this spec.'},
  paddle: {kind: 'github', repo: 'PaddleHQ/paddle-openapi', commit: 'c8207382fa0fa660620a02a23a6a2806ae8894fb', commitDate: '2026-10-26T11:04:14Z',
    files: ['v1/openapi.yaml'], license: 'Apache-2.0', licenseFiles: ['LICENSE'], confidence: 'official-spec', notes: 'Sandbox API keys contain _sdbx (developer.paddle.com/sdks/sandbox).'},
  square: {kind: 'github', repo: 'square/connect-api-specification', commit: '0689c901bdfe1ff73f47aa28b17ccd6e0c40bf2d', commitDate: '2026-09-15T21:22:51Z',
    files: ['api.json'], license: 'Apache-2.0', licenseFiles: ['LICENSE.txt'], confidence: 'official-spec', notes: 'Square search endpoints are POST and are excluded. info.version is 2.0, so Square-Version is pinned to 2026-09-16, the default in the oauth2 securityScheme x-additional-headers of this commit. The spec declares only connect.squareup.com; the sandbox host connect.squareupsandbox.com comes from developer.squareup.com docs.'},
  adyen: {kind: 'github', repo: 'Adyen/adyen-openapi', commit: '1d165a07700491fe3eff1e368ffe090a33251e19', commitDate: '2026-10-29T13:53:45Z',
    files: ['json/CheckoutService-v71.json'], license: 'MIT', licenseFiles: ['LICENSE'], confidence: 'official-spec', notes: 'Checkout API is mostly POST; only GET /paymentLinks/{linkId} is allowlisted (GET /storedPaymentMethods returns stored card tokens and GET /sessions needs a sessionResult, so neither is used). No list endpoint exists, so the connect check reads a non-existent link: 404 means the key was accepted. Live host https://{prefix}-checkout-live.adyenpayments.com/checkout/v71 is from Adyen live-endpoint docs; the spec declares only the test server.'},
  chargebee: {kind: 'github', repo: 'chargebee/openapi', commit: '06f6ff8a4dd98577961acb29bf1d2d0c41684748', commitDate: '2026-09-24T16:12:53Z',
    files: ['spec/chargebee_api_v2_pc_v2_spec.json'], license: 'MIT', licenseFiles: ['LICENSE'], confidence: 'official-spec-early-access', notes: 'Labelled early-access per the user.'},
  // No license file upstream: only our own machine-generated digest (paths, parameter names/types,
  // required response fields) is stored. No upstream text (descriptions, examples) is copied.
  mollie: {kind: 'digest', repo: 'mollie/openapi', commit: '84b4900bc0d6b13eb8c2f0481acd7b24924512cf', commitDate: '2026-10-26T16:20:32Z',
    files: ['specs.yaml'], license: 'none (no license file upstream)', licenseFiles: [], confidence: 'official-spec',
    notes: 'Upstream repository has no license file. contract.json is a digest of names, types and required fields only. Needs a licensing decision by the user.'},
  dodo: {kind: 'docs-excerpt', base: 'https://docs.dodopayments.com/api-reference/', license: 'Apache-2.0 (stated in each excerpt info.license)', confidence: 'official-spec',
    pages: ['payments/get-payments-1', 'payments/get-payments', 'payments/retrieve-retry-state', 'subscriptions/get-subscriptions', 'subscriptions/get-subscriptions-1', 'refunds/get-refunds', 'refunds/get-refunds-1', 'customers/get-customers-1'],
    notes: 'Per-endpoint OpenAPI 3.1 excerpts embedded in docs pages. /openapi/openapi.documented.yml returned 404 during planning. GET /invoices/payments/{payment_id} returns application/pdf (not JSON), so it is not allowlisted; invoice links come from the payment invoice_url field. The refunds list has no payment_id filter in this spec; refunds are listed by customer_id. Page names: get-payments-1 = retrieve one, get-subscriptions = retrieve one (Mintlify numbering).'},
  razorpay: {kind: 'docs', license: 'docs (no spec license)', confidence: 'docs-derived',
    pages: ['https://razorpay.com/docs/api/payments/fetch-with-id/', 'https://razorpay.com/docs/api/payments/fetch-all-payments/', 'https://razorpay.com/docs/api/orders/fetch-with-id/', 'https://razorpay.com/docs/api/orders/fetch-payments/', 'https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment/', 'https://razorpay.com/docs/api/payments/invoices/fetch-with-id/', 'https://razorpay.com/docs/api/payments/subscriptions/fetch-subscription-id/', 'https://razorpay.com/docs/api/customers/fetch-with-id/'],
    notes: 'No official OpenAPI found. contract.json is hand-written from these docs pages.'},
  lemonsqueezy: {kind: 'docs', license: 'docs (no spec license)', confidence: 'docs-derived',
    pages: ['https://docs.lemonsqueezy.com/api/orders/the-order-object', 'https://docs.lemonsqueezy.com/api/orders/retrieve-order', 'https://docs.lemonsqueezy.com/api/orders/list-all-orders', 'https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object', 'https://docs.lemonsqueezy.com/api/subscriptions/retrieve-subscription', 'https://docs.lemonsqueezy.com/api/subscription-invoices/the-subscription-invoice-object', 'https://docs.lemonsqueezy.com/api/subscription-invoices/list-all-subscription-invoices', 'https://docs.lemonsqueezy.com/api/customers/the-customer-object', 'https://docs.lemonsqueezy.com/api/users/retrieve-user'],
    notes: 'JSON:API. contract.json is hand-written from these docs pages.'},
};

const provider = process.argv[2];
const check = process.argv.includes('--check');
if (!provider || !SOURCES[provider]) {
  console.error('Usage: node scripts/billing-specs/vendor.mjs <' + Object.keys(SOURCES).join('|') + '> [--check]');
  process.exit(2);
}
const src = SOURCES[provider];
const dir = path.join('fixtures', 'billing-specs', provider);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  const r = await fetch(url, {redirect: 'follow'});
  if (!r.ok) throw Error(`${url} -> HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
function parseSpec(file, buf) {
  const text = buf.toString('utf8');
  if (/\.ya?ml$/i.test(file)) return require('js-yaml').load(text);
  return JSON.parse(text);
}
function readOperations() {
  const p = path.join(dir, 'operations.json');
  if (!fs.existsSync(p)) throw Error(`${p} missing: write the provider's operation allowlist first.`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Keys whose children are names (not schema keywords): never strip inside these maps.
const NAME_MAPS = new Set(['properties', 'patternProperties', 'schemas', 'parameters', 'responses', 'headers', 'content', 'securitySchemes', 'variables', 'scopes', 'mapping', 'requestBodies', 'paths', '$defs', 'definitions', 'links', 'callbacks', 'encoding']);
const DROP = new Set(['description', 'summary', 'examples', 'example', 'externalDocs', 'tags', 'x-codeSamples', 'x-code-samples']);
function strip(node, parentIsNameMap = false) {
  if (Array.isArray(node)) return node.map((v) => strip(v));
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (!parentIsNameMap && (DROP.has(k) || k.startsWith('x-'))) continue;
    out[k] = strip(v, !parentIsNameMap && NAME_MAPS.has(k));
  }
  return out;
}
function collectRefs(node, acc) {
  if (Array.isArray(node)) { for (const v of node) collectRefs(v, acc); return; }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) acc.add(v);
    else collectRefs(v, acc);
  }
}
const getPointer = (doc, ref) => ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((o, k) => (o == null ? undefined : o[k]), doc);
function setPointer(doc, ref, value) {
  const parts = ref.slice(2).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let o = doc;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
}

// Prune one OpenAPI document to the named operations plus every transitively referenced component.
function prune(spec, ops, file) {
  const out = {file, openapi: spec.openapi ?? spec.swagger, info: {title: spec.info?.title, version: spec.info?.version, license: spec.info?.license}, servers: spec.servers ?? [], security: spec.security, paths: {}, components: {securitySchemes: spec.components?.securitySchemes ?? {}}};
  const missing = [];
  for (const op of ops) {
    const item = spec.paths?.[op.path];
    const m = op.method.toLowerCase();
    if (!item?.[m]) { missing.push(`${op.method} ${op.path}`); continue; }
    out.paths[op.path] ??= {};
    if (item.parameters) out.paths[op.path].parameters = item.parameters;
    out.paths[op.path][m] = item[m];
  }
  const seen = new Set();
  let frontier = new Set();
  collectRefs(out.paths, frontier);
  collectRefs(out.components.securitySchemes, frontier);
  while (frontier.size) {
    const next = new Set();
    for (const ref of frontier) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      const v = getPointer(spec, ref);
      if (v === undefined) { missing.push('unresolved ' + ref); continue; }
      setPointer(out, ref, v);
      collectRefs(v, next);
    }
    frontier = next;
  }
  return {doc: strip(out), missing};
}

async function vendorGithub() {
  const ops = readOperations().filter((o) => !o.authExchange);
  const documents = [], hashes = {}, notes = [];
  for (const file of src.files) {
    const url = GH(src.repo, src.commit, file);
    const buf = await download(url);
    hashes[file] = {url, sha256: sha256(buf), bytes: buf.length};
    if (check) continue;
    const spec = parseSpec(file, buf);
    const mine = ops.filter((o) => (o.file ?? src.files[0]) === file);
    if (!mine.length) continue;
    const {doc, missing} = prune(spec, mine, file);
    if (missing.length) notes.push(`${file}: missing ${missing.join(', ')}`);
    documents.push(doc);
  }
  return {documents, hashes, notes};
}

// Mollie: our own digest. Only names, types, enums and required lists; no upstream prose.
function digestSchema(spec, schema, depth = 0) {
  if (!schema || depth > 6) return {};
  if (schema.$ref) return digestSchema(spec, getPointer(spec, schema.$ref), depth + 1);
  const out = {};
  if (schema.type) out.type = schema.type;
  if (schema.nullable) out.nullable = true;
  if (schema.enum) out.enum = schema.enum;
  if (schema.format === 'date-time') out.format = 'date-time';
  for (const k of ['allOf', 'anyOf', 'oneOf']) if (schema[k]) out[k] = schema[k].map((s) => digestSchema(spec, s, depth + 1));
  if (schema.required) out.required = schema.required;
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, digestSchema(spec, v, depth + 1)]));
  if (schema.items) out.items = digestSchema(spec, schema.items, depth + 1);
  return out;
}
async function vendorDigest() {
  const ops = readOperations();
  const file = src.files[0];
  const url = GH(src.repo, src.commit, file);
  const buf = await download(url);
  const hashes = {[file]: {url, sha256: sha256(buf), bytes: buf.length}};
  if (check) return {hashes, notes: []};
  const spec = parseSpec(file, buf);
  const notes = [];
  const resolve = (p) => (p?.$ref ? getPointer(spec, p.$ref) : p);
  const contract = {provider, generatedFrom: file, servers: (spec.servers ?? []).map((s) => s.url), auth: Object.values(spec.components?.securitySchemes ?? {}).map((s) => ({type: s.type, scheme: s.scheme, in: s.in, name: s.name})), operations: {}};
  for (const op of ops) {
    const item = spec.paths?.[op.path];
    const o = item?.[op.method.toLowerCase()];
    if (!o) { notes.push(`missing ${op.method} ${op.path}`); continue; }
    const params = [...(item.parameters ?? []), ...(o.parameters ?? [])].map(resolve).map((p) => ({name: p.name, in: p.in, required: !!p.required, schema: digestSchema(spec, p.schema)}));
    const responses = {};
    for (const [status, r0] of Object.entries(o.responses ?? {})) {
      const r = resolve(r0);
      const media = Object.entries(r?.content ?? {}).find(([t]) => /json/.test(t));
      if (media && /^2/.test(status)) responses[status] = {contentType: media[0], schema: digestSchema(spec, media[1].schema)};
    }
    contract.operations[op.id] = {method: op.method, path: op.path, params, responses};
  }
  fs.writeFileSync(path.join(dir, 'contract.json'), JSON.stringify(contract, null, 1) + '\n');
  return {hashes, notes};
}

// Dodo: OpenAPI 3.1 excerpt in a fenced ```yaml <method> <path> block on each docs page.
async function vendorDocsExcerpt() {
  const documents = [], hashes = {}, notes = [];
  const ops = readOperations();
  for (const page of src.pages) {
    const url = src.base + page + '.md';
    let buf;
    try { buf = await download(url); } catch (e) { notes.push(`${page}: ${e.message}`); continue; }
    hashes[page] = {url, sha256: sha256(buf), bytes: buf.length};
    if (check) continue;
    const m = buf.toString('utf8').match(/```ya?ml\s+(get|post|put|patch|delete)\s+(\S+)\s*\n([\s\S]*?)\n```/i);
    if (!m) { notes.push(`${page}: no OpenAPI excerpt block`); continue; }
    const spec = require('js-yaml').load(m[3]);
    const mine = ops.filter((o) => o.method.toLowerCase() === m[1].toLowerCase() && o.path === m[2]);
    if (!mine.length) { notes.push(`${page}: ${m[1].toUpperCase()} ${m[2]} not in operations.json`); continue; }
    const {doc, missing} = prune(spec, mine, page);
    if (missing.length) notes.push(`${page}: missing ${missing.join(', ')}`);
    documents.push(doc);
  }
  return {documents, hashes, notes};
}

async function vendorDocs() {
  const hashes = {}, notes = [];
  for (const url of src.pages) {
    try { const buf = await download(url); hashes[url] = {url, sha256: sha256(buf), bytes: buf.length}; }
    catch (e) { notes.push(`${url}: ${e.message}`); }
  }
  return {hashes, notes};
}

async function main() {
  fs.mkdirSync(dir, {recursive: true});
  const result = src.kind === 'github' ? await vendorGithub() : src.kind === 'digest' ? await vendorDigest() : src.kind === 'docs-excerpt' ? await vendorDocsExcerpt() : await vendorDocs();
  const sourcePath = path.join(dir, 'SOURCE.json');
  if (check) {
    const recorded = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    let bad = 0;
    for (const [k, v] of Object.entries(result.hashes)) {
      const want = recorded.upstream?.[k]?.sha256;
      const same = want === v.sha256;
      // Docs pages are rendered HTML and drift; only pinned git files must match exactly.
      const strict = src.kind === 'github' || src.kind === 'digest';
      if (!same && strict) bad++;
      console.log(`${provider} ${k}: ${same ? 'sha256 MATCH' : strict ? 'sha256 MISMATCH' : 'reachable (docs page drifted; informational)'} ${v.sha256.slice(0, 16)}`);
    }
    for (const n of result.notes) console.log(`${provider} note: ${n}`);
    if (bad || (src.kind === 'docs-excerpt' && result.notes.length)) process.exit(1);
    console.log(`PASS ${provider} --check`);
    return;
  }
  if (result.documents) fs.writeFileSync(path.join(dir, 'subset.json'), JSON.stringify({provider, documents: result.documents}, null, 1) + '\n');
  const source = {
    provider, sourceUrl: src.repo ? `https://github.com/${src.repo}` : src.base ?? src.pages[0], repo: src.repo ?? null, commit: src.commit ?? null, commitDate: src.commitDate ?? null,
    file: src.files ?? src.pages, upstream: result.hashes, license: src.license, retrievedAt: new Date().toISOString(), confidence: src.confidence,
    notes: [src.notes, ...result.notes].filter(Boolean).join(' '),
  };
  if (src.kind === 'docs-excerpt' && result.documents.length) {
    const versions = [...new Set(result.documents.map((d) => d.info?.version).filter(Boolean))];
    const licenses = [...new Set(result.documents.map((d) => d.info?.license?.name).filter(Boolean))];
    source.infoVersion = versions.join(',');
    source.notes += ` info.version ${versions.join(',')}; info.license ${licenses.join(',')}.`;
  }
  fs.writeFileSync(sourcePath, JSON.stringify(source, null, 1) + '\n');
  for (const lf of src.licenseFiles ?? []) {
    const buf = await download(GH(src.repo, src.commit, lf));
    fs.writeFileSync(path.join(dir, 'LICENSE.upstream' + (lf.endsWith('.txt') ? '.txt' : '')), buf);
  }
  console.log(`${provider}: wrote ${dir} (${result.notes.length} notes)`);
  for (const n of result.notes) console.log('  note: ' + n);
}
main().catch((e) => { console.error(`${provider}: FAIL ${e.message}`); process.exit(1); });
