import test from 'node:test';
import assert from 'node:assert/strict';
import {
  duplicateGroups,
  defaultClosures,
  canCloseCopy,
  keeperPlan,
} from '../extension/lib/duplicates.js';
const tab = (id, url, extra = {}) => ({ tabId: id, url, lastAccessed: id, ...extra });
test('only identical full addresses form duplicate groups', () => {
  const rows = [
    tab(1, 'https://example.com/?q=a#one'),
    tab(2, 'https://example.com/?q=a#one'),
    tab(3, 'https://example.com/?q=b#one'),
    tab(4, 'https://example.com/?q=a#two'),
    tab(5, 'http://example.com/?q=a#one'),
    tab(6, 'chrome://newtab'),
    tab(7, 'chrome://newtab'),
    tab(8, 'https://example.com/?q=a#one', { pendingUrl: 'https://elsewhere.com' }),
  ];
  const groups = duplicateGroups(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].copies.map((t) => t.tabId),
    [2, 1],
  );
});
test('suggestions keep newest, pinned, playing, and active copies', () => {
  const rows = [
    tab(1, 'https://x.com', { pinned: true }),
    tab(2, 'https://x.com', { audible: true }),
    tab(3, 'https://x.com', { active: true }),
    tab(4, 'https://x.com'),
    tab(5, 'https://x.com'),
    tab(6, 'https://x.com'),
  ];
  assert.deepEqual([...defaultClosures(duplicateGroups(rows), 4)], [5]);
});
test('one keeper is required and the closing plan names its original tab', () => {
  const groups = duplicateGroups([
    tab(1, 'https://x.com'),
    tab(2, 'https://x.com'),
    tab(3, 'https://x.com'),
  ]);
  const closing = new Set([1, 2]);
  assert.equal(canCloseCopy(groups[0], 3, closing), false);
  assert.deepEqual(keeperPlan(groups, closing), [{ url: 'https://x.com', ids: [3] }]);
});
