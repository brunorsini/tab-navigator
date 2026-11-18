import test from 'node:test';
import assert from 'node:assert/strict';
import { openSplitView, splitAvailability } from '../extension/lib/split-view.js';

function fixture() {
  const tabs = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    index: i,
    windowId: 1,
    groupId: -1,
    pinned: false,
    splitViewId: -1,
    url: 'https://example.com/' + i,
  }));
  const calls = [];
  const api = {
    runtime: { getURL: () => 'chrome-extension://test/' },
    windows: { update: async (...args) => calls.push(['focus', ...args]) },
    tabs: {
      get: async (id) => structuredClone(tabs.find((tab) => tab.id === id)),
      update: async (...args) => calls.push(['activate', ...args]),
      move: async (id, { index }) => {
        calls.push(['move', id, index]);
        const old = tabs.findIndex((tab) => tab.id === id);
        tabs.splice(index, 0, tabs.splice(old, 1)[0]);
        tabs.forEach((tab, i) => (tab.index = i));
      },
      createSplit: async (ids) => {
        calls.push(['split', ids]);
        return 42;
      },
    },
  };
  return { api, tabs, calls };
}
test('native split uses exactly the selected pair, placing them adjacent without opening copies', async () => {
  const { api, tabs, calls } = fixture();
  assert.deepEqual(await openSplitView(api, [4, 1]), { splitViewId: 42, count: 2 });
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [1, 4, 2, 3],
  );
  assert.deepEqual(calls.slice(0, 2), [
    ['move', 4, 1],
    ['split', [1, 4]],
  ]);
});
test('split rejects invalid counts, old Chrome, existing splits, windows, pins and groups before mutation', async () => {
  for (const ids of [[1], [1, 2, 3], [1, 1]]) {
    const f = fixture();
    await assert.rejects(openSplitView(f.api, ids), /exactly 2/);
    assert.equal(f.calls.length, 0);
  }
  for (const patch of [
    { windowId: 2 },
    { pinned: true },
    { groupId: 7 },
    { splitViewId: 3 },
    { incognito: true },
  ]) {
    const f = fixture();
    Object.assign(f.tabs[1], patch);
    await assert.rejects(openSplitView(f.api, [1, 2]));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  delete f.api.tabs.createSplit;
  await assert.rejects(openSplitView(f.api, [1, 2]), /Chrome 155/);
  assert.equal(f.calls.length, 0);
});
test('a rejected split restores its adjacency move; existing adjacent tabs need no move', async () => {
  const f = fixture();
  f.api.tabs.createSplit = async () => {
    throw Error('not allowed');
  };
  await assert.rejects(openSplitView(f.api, [1, 4]), /not allowed/);
  assert.deepEqual(
    f.tabs.map((tab) => tab.id),
    [1, 2, 3, 4],
  );
  const other = fixture();
  await openSplitView(other.api, [1, 2]);
  assert(!other.calls.some((call) => call[0] === 'move'));
});
test('split rechecks changed group state and preserves a completed split if focus fails', async () => {
  const f = fixture(),
    move = f.api.tabs.move;
  f.api.tabs.move = async (...args) => {
    await move(...args);
    f.tabs.find((tab) => tab.id === 4).groupId = 10;
  };
  await assert.rejects(openSplitView(f.api, [1, 4]), /same group/);
  assert(!f.calls.some((call) => call[0] === 'split'));
  const other = fixture();
  other.api.tabs.update = async () => {
    throw Error('focus failure');
  };
  assert.equal((await openSplitView(other.api, [1, 4])).splitViewId, 42);
  assert.deepEqual(
    other.tabs.map((tab) => tab.id),
    [1, 4, 2, 3],
  );
  assert.equal(splitAvailability(other.tabs.slice(0, 2), true), '');
});
