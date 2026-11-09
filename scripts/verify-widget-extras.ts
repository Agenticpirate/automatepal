// Phase 1 widget extras without network or database: per-page starters, language choice and translation
// completeness, logo file checks, and the settings schema for the new controls.
import assert from 'node:assert/strict';
import {startersFor, widgetSettings} from '../lib/widget';
import {resolveLang, WIDGET_TEXT, LANG_NAMES} from '../lib/widget-i18n';
import {logoMatches, LOGO_TYPES} from '../lib/widget-logo';
let n = 0;
const ok = () => { n++; };
const D = ['Default one', 'Default two'];
const rules = [{path: '/docs', prompts: ['Docs question']}, {path: '/docs/billing', prompts: ['Billing docs question']}, {path: '/pricing', prompts: ['Which plan?']}];
assert.deepEqual(startersFor('/docs/billing/refunds', rules, D), ['Billing docs question'], 'longest prefix wins'); ok();
assert.deepEqual(startersFor('/docs/setup', rules, D), ['Docs question']); ok();
assert.deepEqual(startersFor('/docsearch', rules, D), D, 'prefix must end at a path segment'); ok();
assert.deepEqual(startersFor('/pricing', rules, D), ['Which plan?'], 'exact path'); ok();
assert.deepEqual(startersFor('/about', rules, D), D); assert.deepEqual(startersFor(null, rules, D), D); assert.deepEqual(startersFor('/x', [], D), D); ok();
assert.deepEqual(startersFor('/anything', [{path: '/', prompts: ['Site-wide']}], D), ['Site-wide'], 'root rule covers every page'); ok();
assert.equal(resolveLang('es', ['de-DE']), 'es', 'owner choice wins'); ok();
assert.equal(resolveLang('auto', ['zz', 'te-IN', 'hi']), 'te', 'first supported browser language'); ok();
assert.equal(resolveLang('auto', ['ja-JP']), 'en'); assert.equal(resolveLang(undefined, []), 'en'); assert.equal(resolveLang('xx', ['fr']), 'fr', 'unknown setting falls back to auto'); ok();
const keys = Object.keys(WIDGET_TEXT.en);
for (const lang of Object.keys(LANG_NAMES) as (keyof typeof WIDGET_TEXT)[]) {
  const t = WIDGET_TEXT[lang];
  assert.deepEqual(Object.keys(t).sort(), [...keys].sort(), `${lang}: same keys as English`);
  for (const k of keys) assert.ok((t as Record<string, string>)[k].trim().length > 0, `${lang}.${k} is not empty`);
  if (lang !== 'en') assert.notEqual(t.title, WIDGET_TEXT.en.title, `${lang} is translated`);
  ok();
}
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
const webp = new Uint8Array([...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)), [0]));
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
assert.ok(logoMatches('image/png', png) && logoMatches('image/jpeg', jpg) && logoMatches('image/webp', webp)); ok();
assert.ok(!logoMatches('image/png', jpg) && !logoMatches('image/jpeg', png) && !logoMatches('image/png', svg) && !logoMatches('image/svg+xml', svg) && !logoMatches('image/png', new Uint8Array([0x89]))); ok();
assert.deepEqual([...LOGO_TYPES], ['image/png', 'image/jpeg', 'image/webp'], 'no SVG'); ok();
const base = {label: 'Help', color: '#233de8', initials: 'AP', prompts: []};
const parsed = widgetSettings.parse({...base, language: 'hi', pageStarters: [{path: '/pricing', prompts: ['Which plan?']}]});
assert.equal(parsed.language, 'hi'); assert.equal(parsed.pageStarters.length, 1); ok();
assert.equal(widgetSettings.parse(base).language, 'auto'); assert.deepEqual(widgetSettings.parse(base).pageStarters, []); ok();
for (const bad of [{language: 'xx'}, {pageStarters: [{path: 'pricing', prompts: ['Which plan?']}]}, {pageStarters: [{path: '//evil', prompts: ['Which plan?']}]}, {pageStarters: [{path: '/p', prompts: []}]}, {pageStarters: [{path: '/p', prompts: ['a', 'b', 'c', 'd', 'e'].map(x => x.repeat(3))}]}, {pageStarters: Array.from({length: 11}, (_, i) => ({path: '/p' + i, prompts: ['Question']}))}]) {
  assert.equal(widgetSettings.safeParse({...base, ...bad}).success, false, JSON.stringify(bad).slice(0, 60));
}
ok();
console.log(`PASS widget extras: ${n} checks; per-page starters (longest prefix, segment boundary, root rule), language choice, ${Object.keys(LANG_NAMES).length} complete translations, logo magic bytes (no SVG), schema bounds.`);
