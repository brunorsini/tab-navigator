import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, touch, removeTab, cycleTarget } from '../extension/lib/state.js';
const tabs = [
  { id: 1, lastAccessed: 30 },
  { id: 2, lastAccessed: 20 },
  { id: 3, lastAccessed: 10 },
];
test('first run recovers recency from Chrome without invented creation times', () => {
  const state = reconcile({}, tabs);
  assert.deepEqual(state.order, [1, 2, 3]);
  assert.equal(state.created[1], 0);
});
test('rehydration removes stale and duplicate tab IDs', () => {
  const state = reconcile({ order: [2, 2, 77, 1], seen: { 2: 40, 77: 90 } }, tabs);
  assert.deepEqual(state.order, [2, 1, 3]);
  assert.equal(state.seen[77], undefined);
});
test('Chrome can repair a missed activation without an older cache hiding it', () => {
  const now = Date.now(),
    old = now - 23 * 3600000,
    recent = now - 5 * 60000;
  const state = reconcile(
    { order: [2, 1], seen: { 1: old, 2: old + 1 } },
    [
      { id: 1, url: 'https://cnn.acme.com.br/#section', lastAccessed: recent },
      { id: 2, url: 'https://cnn.acme.com.br/', lastAccessed: old + 1 },
    ],
    now,
  );
  assert.equal(state.seen[1], recent);
  assert.deepEqual(state.order, [1, 2]);
});
test('a newer recorded window focus wins over Chrome and fragments do not share timestamps', () => {
  const state = reconcile({ order: [1, 2], seen: { 1: 100 } }, [
    { id: 1, url: 'https://example.com/#first', lastAccessed: 10 },
    { id: 2, url: 'https://example.com/#second', lastAccessed: 20 },
  ]);
  assert.equal(state.seen[1], 100);
  assert.equal(state.seen[2], 20);
  assert.deepEqual(state.order, [1, 2]);
});
test('visits preserve two-tab toggling', () => {
  const state = reconcile({}, tabs);
  touch(state, 2, 100);
  assert.equal(state.order[1], 1);
  touch(state, state.order[1], 101);
  assert.equal(state.order[1], 2);
});
test('rapid cycling follows a frozen order instead of bouncing between two tabs', () => {
  const state = reconcile({}, tabs);
  assert.equal(cycleTarget(state, 1, 1, [1, 2, 3], 100), 2);
  touch(state, 2, 100, true);
  assert.equal(cycleTarget(state, 2, 1, [1, 2, 3], 200), 3);
  touch(state, 3, 200, true);
  assert.equal(cycleTarget(state, 3, 1, [1, 2, 3], 300), 1);
});
test('reverse cycling walks back along the same snapshot', () => {
  const state = reconcile({}, tabs);
  cycleTarget(state, 1, 1, [1, 2, 3], 100);
  touch(state, 2, 100, true);
  assert.equal(cycleTarget(state, 2, -1, [1, 2, 3], 200), 1);
});
test('idle timeout begins a new cycle from the current MRU list', () => {
  const state = reconcile({}, tabs);
  cycleTarget(state, 1, 1, [1, 2, 3], 100);
  touch(state, 2, 100, true);
  assert.equal(cycleTarget(state, 2, 1, [1, 2, 3], 2000), 1);
});
test('a manual selection resets the frozen cycle', () => {
  const state = reconcile({}, tabs);
  cycleTarget(state, 1, 1, [1, 2, 3], 100);
  touch(state, 3, 101);
  assert.equal(state.cycle, null);
  assert.equal(cycleTarget(state, 3, 1, [1, 2, 3], 200), 1);
});
test('a closed tab is pruned from recency, timestamps, and cycling', () => {
  const state = reconcile({}, tabs);
  cycleTarget(state, 1, 1, [1, 2, 3], 100);
  removeTab(state, 2);
  assert.deepEqual(state.order, [1, 3]);
  assert.equal(state.cycle, null);
  assert.equal(state.seen[2], undefined);
});
test('cycling respects a window-scoped eligible list and single-tab windows', () => {
  const state = reconcile({}, tabs);
  assert.equal(cycleTarget(state, 1, 1, [1, 3], 100), 3);
  assert.equal(cycleTarget(state, 1, 1, [1], 200), null);
});
test('a live cycling snapshot survives worker restart', () => {
  const state = reconcile({}, tabs);
  cycleTarget(state, 1, 1, [1, 2, 3], 100);
  touch(state, 2, 100, true);
  const restored = reconcile(JSON.parse(JSON.stringify(state)), tabs, 200);
  assert.equal(cycleTarget(restored, 2, 1, [1, 2, 3], 300), 3);
});
