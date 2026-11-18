import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  duplicateGroups,
  refreshDuplicateGroups,
  defaultClosures,
  canCloseCopy,
  keeperPlan,
} from '../extension/lib/duplicates.js';
import { normalize } from '../extension/lib/search.js';
import { recency } from '../extension/lib/recency.js';
import { createUndoBars } from '../extension/lib/undo-bars.js';

// Exercise the real review-page handlers with a small DOM substitute. No user
// browser, tab, permission, or bookmark is touched by these interaction tests.
async function reviewPage() {
  const source = (
    await readFile(new URL('../extension/review.js', import.meta.url), 'utf8')
  ).replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '');
  const roots = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.value = '';
      this.className = '';
      this.disabled = false;
      this.classList = { toggle() {}, add() {} };
    }
    append(...items) {
      for (const item of items.flatMap((item) =>
        item.tag === 'fragment' ? item.children : [item],
      )) {
        item.parent = this;
        this.children.push(item);
      }
    }
    replaceChildren(...items) {
      this.children = [];
      this.append(...items);
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    addEventListener(name, handler) {
      (this.listeners[name] ||= []).push(handler);
    }
    async click() {
      if (!this.disabled)
        for (const handler of this.listeners.click || []) await handler({ target: this });
    }
    focus() {}
  }
  const walk = (node) => [node, ...node.children.flatMap(walk)];
  const matches = (node, selector) => {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      if (!matches(node, parts.pop())) return false;
      for (let parent = node.parent; parent; parent = parent.parent)
        if (matches(parent, parts.join(' '))) return true;
      return false;
    }
    const tag = selector.match(/^[a-z]+/)?.[0];
    if (tag && tag !== node.tag) return false;
    for (const [, cls] of selector.matchAll(/\.([\w-]+)/g))
      if (!node.className.split(' ').includes(cls)) return false;
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)) {
      if (
        String(name.startsWith('data-') ? node.dataset[name.slice(5)] : node.attributes[name]) !==
        value
      )
        return false;
    }
    return true;
  };
  const document = {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('fragment'),
    getElementById(id) {
      if (!roots.has(id)) roots.set(id, new Element());
      return roots.get(id);
    },
    querySelectorAll(selector) {
      return [...roots.values()]
        .flatMap(walk)
        .filter((node) => selector.split(',').some((part) => matches(node, part)));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0];
    },
  };
  const tabs = Array.from({ length: 7 }, (_, i) => ({
    tabId: i + 1,
    windowId: 1,
    lastAccessed: i + 1,
    url: i < 4 ? 'https://alpha.example/' : 'https://beta.example/',
    title: i < 4 ? 'Alpha' : 'Beta',
  }));
  const calls = [];
  const windowEvents = {};
  const request = async (type, data = {}) => {
    calls.push(structuredClone({ type, ...data }));
    if (type === 'snapshot')
      return { tabs: structuredClone(tabs), settings: {}, closeReviewVersion: 1, undo: [] };
    if (type === 'prepare-close')
      return {
        token: 'review-token',
        rows: tabs
          .filter((tab) => data.tabIds.includes(tab.tabId))
          .map((tab) => ({
            ...tab,
            check: {
              status: tab.tabId === 1 ? 'clear' : tab.tabId === 2 ? 'possible' : 'unknown',
              reason: 'Test input check',
            },
          })),
      };
    throw Error(`Unexpected request: ${type}`);
  };
  await vm.runInNewContext(`(async()=>{${source}\n})()`, {
    document,
    request,
    applyTheme() {},
    duplicateGroups,
    refreshDuplicateGroups,
    defaultClosures,
    canCloseCopy,
    keeperPlan,
    normalize,
    recency,
    createUndoBars,
    URL,
    URLSearchParams,
    location: { search: '?from=99' },
    window: {
      scrollTo() {},
      addEventListener(type, fn) {
        windowEvents[type] = fn;
      },
    },
    chrome: { runtime: { getURL: (path) => `chrome-extension://test/${path}` } },
  });
  return { document, calls, tabs, focus: () => windowEvents.focus() };
}

test('a group Close action reviews only that group and keeps risky copies by default', async () => {
  const { document, calls } = await reviewPage();
  assert.equal(document.getElementById('primary').textContent, 'Review 5 closures →');
  const closeAlpha = document
    .querySelectorAll('.group-close')
    .find((button) => button.attributes['aria-label'].includes('Alpha'));
  assert.equal(closeAlpha.textContent, 'Close 3…');
  await closeAlpha.click();
  const prepared = calls.find((call) => call.type === 'prepare-close');
  assert.deepEqual(prepared.tabIds, [3, 2, 1]);
  assert.deepEqual(prepared.keepers, [{ url: 'https://alpha.example/', ids: [4] }]);
  assert.equal(document.getElementById('stat-two').textContent, '3');
  assert.equal(document.getElementById('primary').textContent, 'Close 1 tabs');
  assert.equal(
    document.querySelector('button[data-tab="1"][data-choice="close"]').attributes['aria-pressed'],
    'true',
  );
  for (const id of [2, 3])
    assert.equal(
      document.querySelector(`button[data-tab="${id}"][data-choice="keep"]`).attributes[
        'aria-pressed'
      ],
      'true',
    );
  assert(
    !calls.some((call) => call.type === 'close-tabs'),
    'the group button must never close tabs directly',
  );
});

test('returning from a tab refreshes its age and group label without moving rows or resetting choices', async () => {
  const { document, tabs, focus } = await reviewPage();
  await document.querySelector('button[data-tab="3"][data-choice="keep"]').click();
  const order = () => document.querySelectorAll('.copy-row').map((row) => row.dataset.tab);
  const before = order();
  tabs[0].lastAccessed = Date.now();
  await focus();
  assert.deepEqual(order(), before);
  assert.equal(document.querySelector('.copy-row[data-tab="1"] time').textContent, 'Used just now');
  assert.equal(
    document.querySelector('.copy-row[data-tab="1"] .recommended').textContent,
    'Most recent in this group',
  );
  assert.equal(
    document.querySelector('button[data-tab="1"][data-choice="close"]').attributes['aria-pressed'],
    'true',
  );
  assert.equal(
    document.querySelector('button[data-tab="3"][data-choice="keep"]').attributes['aria-pressed'],
    'true',
  );
  await document.getElementById('use-suggestions').click();
  assert.equal(
    document.querySelector('button[data-tab="1"][data-choice="keep"]').attributes['aria-pressed'],
    'true',
  );
});

test('a tab navigating to a different fragment leaves the old duplicate group on return', async () => {
  const { document, tabs, focus } = await reviewPage();
  tabs[0].url += '#another-screen';
  await focus();
  assert.equal(document.querySelector('.copy-row[data-tab="1"]'), undefined);
  assert.equal(document.querySelectorAll('.group-close')[0].textContent, 'Close 2…');
});

test('group button counts track Keep choices and disable when nothing is marked to close', async () => {
  const { document, calls } = await reviewPage();
  await document.querySelector('button[data-tab="3"][data-choice="keep"]').click();
  assert.equal(document.querySelectorAll('.group-close')[0].textContent, 'Close 2…');
  await document.getElementById('keep-all').click();
  for (const button of document.querySelectorAll('.group-close')) {
    assert.equal(button.textContent, 'Close 0…');
    assert.equal(button.disabled, true);
    await button.click();
  }
  assert(!calls.some((call) => call.type === 'prepare-close'));
  await document.getElementById('use-suggestions').click();
  assert.deepEqual(
    document.querySelectorAll('.group-close').map((button) => button.textContent),
    ['Close 3…', 'Close 2…'],
  );
  assert(document.querySelectorAll('.group-close').every((button) => !button.disabled));
});
