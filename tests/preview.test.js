import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPreview } from '../extension/lib/preview.js';
test('preview walks a fixed MRU list without activation or an idle reset', () => {
  const order = [3, 2, 1];
  const first = stepPreview(null, order, 3, order, 1, 100);
  assert.equal(first.ids[first.index], 2);
  const second = stepPreview(first, order, 3, order, 1, 50000);
  assert.equal(second.ids[second.index], 1);
  const back = stepPreview(second, order, 3, order, -1, 60000);
  assert.equal(back.ids[back.index], 2);
  assert.deepEqual(order, [3, 2, 1]);
  assert.equal(back.token, first.token);
});
test('reverse wraps, stale tabs are pruned, one-tab windows do not open a switcher', () => {
  const first = stepPreview(null, [1, 2, 3], 1, [1, 2, 3], -1);
  assert.equal(first.ids[first.index], 3);
  const pruned = stepPreview(first, [1, 3], 1, [1, 3], -1);
  assert.equal(pruned.ids[pruned.index], 1);
  assert.equal(stepPreview(null, [1, 2, 3], 1, [1], 1), null);
});
test('held cycle survives worker rehydration', () => {
  const first = stepPreview(null, [1, 2, 3], 1, [1, 2, 3], 1);
  assert.equal(stepPreview(JSON.parse(JSON.stringify(first)), [1, 2, 3], 1, [1, 2, 3], 1).index, 2);
});
test('an incomplete session from an older build starts a fresh switcher', () => {
  for (const previous of [
    {},
    { ids: [1, 2, 3] },
    { ids: [1, 2, 3], index: 8, token: 'old' },
    { ids: null, index: 0, token: 'old' },
  ]) {
    const preview = stepPreview(previous, [3, 2, 1], 3, [1, 2, 3], 1);
    assert.equal(preview.ids[preview.index], 2);
    assert.notEqual(preview.token, 'old');
  }
});
