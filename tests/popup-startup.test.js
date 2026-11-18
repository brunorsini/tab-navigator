import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startPopup } from '../extension/lib/popup-startup.js';
const build = '1.6.2';
function fixture({ old = false, missing = false, repaired = false } = {}) {
  let loaded = 0,
    reloads = 0,
    closed = 0;
  const location = {
    href: `chrome-extension://test/popup.html?switcher${repaired ? '&repaired=' + build : ''}`,
    replace(url) {
      this.replaced = url;
    },
    reload() {
      reloads++;
    },
  };
  const element = () => ({
    children: [],
    events: {},
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    addEventListener(type, fn) {
      this.events[type] = fn;
    },
    focus() {},
  });
  const document = {
    ...element(),
    body: element(),
    documentElement: { dataset: { paletteBuild: old ? 'old' : build } },
    getElementById: (id) => (missing && id === 'close-palette' ? null : {}),
    createElement: element,
    defaultView: {
      close() {
        closed++;
      },
    },
  };
  return {
    document,
    location,
    build,
    requiredIds: ['search', 'close-palette'],
    load: async () => {
      loaded++;
    },
    loaded: () => loaded,
    reloads: () => reloads,
    closed: () => closed,
  };
}
test('old popup markup is refreshed before any application listener can run', async () => {
  const f = fixture({ old: true });
  assert.equal(await startPopup(f), 'reloading');
  assert.equal(f.loaded(), 0);
  const target = new URL(f.location.replaced);
  assert(target.searchParams.has('switcher'));
  assert.equal(target.searchParams.get('ui'), build);
});
test('a missing button cannot reach the null addEventListener crash', async () => {
  const f = fixture({ missing: true });
  assert.equal(await startPopup(f), 'reloading');
  assert.equal(f.loaded(), 0);
});
test('current markup initializes normally and never reloads', async () => {
  const f = fixture();
  assert.equal(await startPopup(f), 'ready');
  assert.equal(f.loaded(), 1);
  assert.equal(f.location.replaced, undefined);
});
test('failed recovery stops after one attempt and provides working retry and close', async () => {
  const f = fixture({ old: true, repaired: true });
  assert.equal(await startPopup(f), 'incompatible');
  assert.equal(f.location.replaced, undefined);
  const [, , retry, close] = f.document.body.children[0].children;
  retry.events.click();
  close.events.click();
  assert.equal(f.reloads(), 1);
  assert.equal(f.closed(), 1);
});
test('a failed module load presents recovery instead of an uncaught initialization error', async () => {
  const f = fixture();
  f.load = async () => {
    throw Error('missing button');
  };
  assert.equal(await startPopup(f), 'failed');
  assert(f.document.body.children.length);
});
test('packaged markup, loader, manifest, and UI element contract stay in sync', async () => {
  const [html, loader, palette, manifest] = await Promise.all(
    ['popup.html', 'popup.js', 'palette.js', 'manifest.json'].map((file) =>
      readFile(new URL('../extension/' + file, import.meta.url), 'utf8'),
    ),
  );
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const required = [
    ...loader
      .split('requiredIds: [')[1]
      .split(']')[0]
      .matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  for (const id of required) assert(ids.has(id), `Missing required element: ${id}`);
  for (const [, id] of palette.matchAll(/\$\('([^']+)'\)/g))
    assert(required.includes(id), `Missing startup guard: ${id}`);
  assert.equal(JSON.parse(manifest).version, build);
  assert(html.includes(`data-palette-build="${build}"`));
  assert(loader.includes(`const build = '${build}'`));
  assert.equal(JSON.parse(manifest).action.default_popup, `popup.html?ui=${build}`);
});
