import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../extension/palette.js', import.meta.url), 'utf8');
const follow = source.slice(
  source.indexOf('function followActionFocus('),
  source.indexOf('function renderRows('),
);
function fixture({ currentId = 2, targetId = 2, results = [1, 3, 2], old = false } = {}) {
  const notice = {},
    requests = [];
  const state = vm.createContext({
    data: {
      currentId,
      paletteFocus: { token: 'focus-1', tabId: targetId, at: Date.now() - (old ? 61_000 : 0) },
    },
    results: results.map((tabId) => ({ tabId, kind: 'tab' })),
    selected: 0,
    preview: null,
    followedTabId: undefined,
    appliedFocusToken: undefined,
    $: () => notice,
    request: async (type, values) => {
      requests.push({ type, ...values });
    },
  });
  vm.runInContext(follow, state);
  return { state, notice, requests, apply: () => vm.runInContext('followActionFocus()', state) };
}
test('close/restore follows the active tab and requests scrolling without moving any rows', () => {
  const f = fixture();
  assert.equal(f.apply(), true);
  assert.equal(f.state.selected, 2);
  assert.deepEqual(
    f.state.results.map((row) => row.tabId),
    [1, 3, 2],
  );
  assert.equal(f.notice.hidden, true);
  assert.deepEqual(f.requests, [{ type: 'ack-palette-focus', token: 'focus-1' }]);
  f.state.selected = 1;
  assert.equal(f.apply(), false);
  assert.equal(
    f.state.selected,
    1,
    'later refreshes must not pull the highlight away from keyboard navigation',
  );
  assert.equal(f.requests.length, 1);
});
test('a filtered-out active tab explains the mismatch and preserves the query results', () => {
  const f = fixture({ results: [1, 3] });
  assert.equal(f.apply(), false);
  assert.equal(f.notice.hidden, false);
  assert.equal(f.notice.textContent, 'Current tab isn’t in these search results.');
  assert.equal(f.state.selected, 0);
  f.state.results.push({ tabId: 2, kind: 'tab' });
  f.apply();
  assert.equal(f.notice.hidden, true);
});
test('fresh popup consumes a saved focus target, but stale or no-longer-current targets do not steal selection', () => {
  const reopened = fixture();
  assert.equal(reopened.apply(), true);
  for (const options of [{ old: true }, { currentId: 1 }]) {
    const f = fixture(options);
    assert.equal(f.apply(), false);
    assert.equal(f.state.selected, 0);
    assert.equal(f.notice.hidden, true);
    assert.equal(f.requests.length, 1);
  }
});
test('the Arc-style preview keeps its own selection and does not consume an action focus target', () => {
  const f = fixture();
  f.state.preview = { token: 'preview' };
  assert.equal(f.apply(), false);
  assert.equal(f.state.selected, 0);
  assert.equal(f.requests.length, 0);
});
