import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { recency } from '../extension/lib/recency.js';
import { resultLayout, visibleRange } from '../extension/lib/result-view.js';

// Run the real row renderer and bubble clicks through its DOM substitute. This
// catches accidental activation when the nested Close or checkbox is clicked.
async function rows({ preview = false } = {}) {
  class Element {
    constructor(tag, className = '', textContent = '') {
      Object.assign(this, {
        tag,
        className,
        textContent,
        children: [],
        listeners: {},
        attributes: {},
        dataset: {},
        style: {},
      });
    }
    append(...nodes) {
      for (const node of nodes) {
        node.parent = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    click() {
      const event = {
        stopPropagation() {
          this.stopped = true;
        },
        preventDefault() {},
      };
      for (let at = this; at; at = at.parent) {
        at.listeners.click?.(event);
        if (event.stopped) break;
      }
    }
  }
  const results = [
    {
      kind: 'tab',
      id: 'tab-1',
      tabId: 1,
      title: 'Acme',
      url: 'https://cnn.acme.com.br/',
      match: {},
      lastAccessed: Date.now(),
    },
    {
      kind: 'history',
      id: 'history-2',
      title: 'Past page',
      url: 'https://example.com/',
      match: {},
      lastAccessed: 1,
    },
  ];
  const list = new Element('div');
  list.scrollTop = 0;
  list.clientHeight = 350;
  const calls = [],
    node = (tag, className, text) => new Element(tag, className, text);
  const source = await readFile(new URL('../extension/palette.js', import.meta.url), 'utf8');
  const renderer = source.slice(
    source.indexOf('function renderRows('),
    source.indexOf('function setSelected('),
  );
  vm.runInNewContext(`${renderer}\nrenderRows(true);`, {
    $: () => list,
    input: { value: '' },
    layout: resultLayout(results),
    visibleRange,
    renderedStart: -1,
    results,
    selected: 0,
    preview,
    busy: false,
    data: { currentId: 99 },
    picked: new Set(),
    selectionKey: '⌘ ↵',
    document: { createDocumentFragment: () => new Element('fragment') },
    node,
    siteIcon: () => node('span'),
    highlight: (value) => node('text', '', value),
    displayUrl: (value) => value,
    recency,
    closeSingleTab: (id) => calls.push(['close', id]),
    open: (index) => calls.push(['open', index]),
    togglePicked: (id) => calls.push(['select', id]),
  });
  const walk = (el) => [el, ...el.children.flatMap(walk)];
  const all = walk(list),
    find = (cls) => all.filter((el) => el.className?.split(' ').includes(cls));
  return { find, calls };
}
test('Close does not activate the tab; the rest of the row still navigates', async () => {
  const { find, calls } = await rows();
  find('row-close')[0].click();
  assert.deepEqual(calls, [['close', 1]]);
  find('result-title')[0].click();
  assert.deepEqual(calls.at(-1), ['open', 0]);
  find('pick-tab')[0].click();
  assert.deepEqual(calls.at(-1), ['select', 1]);
  assert.equal(find('row-close').length, 1, 'history entries have no tab to close');
});
test('Close is keyboard labeled and does not leak Enter to navigation handlers', async () => {
  const { find } = await rows(),
    button = find('row-close')[0];
  assert.equal(button.attributes['aria-label'], 'Close Acme');
  for (const key of ['Enter', ' ']) {
    const event = {
      key,
      stopPropagation() {
        this.stopped = true;
      },
    };
    button.listeners.keydown(event);
    assert.equal(event.stopped, true);
  }
});
test('the cycle preview keeps its confirmation controls separate from search-row closing', async () => {
  const { find } = await rows({ preview: true });
  assert.equal(find('row-close').length, 0);
});

test('the selected Close button directly removes the selection without opening a review page', async () => {
  const source = await readFile(new URL('../extension/palette.js', import.meta.url), 'utf8');
  const handlers = source.slice(
    source.indexOf('async function closeSingleTab('),
    source.indexOf('function showAction('),
  );
  const binding = source
    .split('\n')
    .find((line) => line.startsWith("$('close-tabs').addEventListener"));
  const calls = [];
  let click,
    refreshed = 0;
  const context = {
    busy: false,
    action: null,
    picked: new Set([1, 2, 3, 4, 5]),
    $: () => ({
      addEventListener: (_, fn) => {
        click = fn;
      },
    }),
    request: async (type, value) => {
      calls.push(structuredClone({ type, ...value }));
      return { count: 5, skipped: 0 };
    },
    holdOrder() {},
    syncSelection() {},
    syncUndo() {},
    renderRows() {},
    notice() {},
    refresh: async () => {
      refreshed++;
    },
  };
  vm.runInNewContext(`${handlers}\n${binding}`, context);
  await click();
  assert.deepEqual(calls, [{ type: 'close-selected', tabIds: [1, 2, 3, 4, 5] }]);
  assert.equal(refreshed, 1);
  assert.equal(context.busy, false);
});
