import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { inspectPageInputs, checkTabInput, checkTabsInput } from '../extension/lib/input-check.js';
const element = (localName, extra = {}) => ({
  localName,
  getAttribute: () => null,
  hasChildNodes: () => false,
  ...extra,
});
function scan(elements) {
  const document = {
    elements,
    createTreeWalker(root) {
      let i = 0;
      return { nextNode: () => root.elements[i++] || null };
    },
  };
  return vm.runInNewContext(`(${inspectPageInputs.toString()})()`, {
    document,
    location: { href: 'https://example.com' },
    NodeFilter: { SHOW_ELEMENT: 1 },
    performance: { now: () => 0 },
  });
}
test('checks flag changed standard inputs without returning their contents', () => {
  for (const field of [
    element('input', { type: 'text', value: 'private draft', defaultValue: '' }),
    element('textarea', { value: 'private draft', defaultValue: '' }),
    element('input', { type: 'checkbox', checked: true, defaultChecked: false }),
    element('input', { type: 'password', value: 'private password' }),
    element('input', { type: 'file', files: { length: 1 } }),
  ]) {
    const result = scan([field]);
    assert.equal(result.status, 'possible');
    assert(!JSON.stringify(result).includes('private'));
  }
  assert.equal(
    scan([element('input', { type: 'text', value: 'saved', defaultValue: 'saved' })]).status,
    'clear',
  );
});
test('editable documents and open shadow-root edits are kept; custom canvases are uncertain', () => {
  assert.equal(
    scan([element('div', { isContentEditable: true, hasChildNodes: () => true })]).status,
    'possible',
  );
  assert.equal(
    scan([
      element('widget', {
        shadowRoot: { elements: [element('textarea', { value: 'draft', defaultValue: '' })] },
      }),
    ]).status,
    'possible',
  );
  assert.equal(scan([element('canvas')]).status, 'unknown');
  assert.equal(scan(Array.from({ length: 12001 }, () => element('div'))).status, 'unknown');
});
test('unchanged implicit single-select defaults do not trigger a warning', () => {
  assert.equal(
    scan([
      element('select', {
        options: [
          { selected: true, defaultSelected: false },
          { selected: false, defaultSelected: false },
        ],
      }),
    ]).status,
    'clear',
  );
  assert.equal(
    scan([
      element('select', {
        options: [
          { selected: false, defaultSelected: false },
          { selected: true, defaultSelected: false },
        ],
      }),
    ]).status,
    'possible',
  );
});
test('sleeping or inaccessible pages are never injected or woken', async () => {
  let calls = 0;
  const api = {
    permissions: { contains: async () => false },
    scripting: {
      executeScript: async () => {
        calls++;
      },
    },
  };
  for (const tab of [
    { id: 1, url: 'https://x.com', discarded: true },
    { id: 1, url: 'https://x.com', frozen: true },
    { id: 1, url: 'chrome://settings' },
    { id: 1, url: 'https://x.com' },
  ])
    assert.equal((await checkTabInput(api, tab)).status, 'unknown');
  assert.equal(calls, 0);
});
test('uninspected frames and navigations are not mislabeled clear', async () => {
  const api = {
    permissions: { contains: async () => true },
    scripting: {
      executeScript: async () => [
        { frameId: 0, result: { status: 'clear', url: 'https://x.com', frames: 1 } },
      ],
    },
  };
  assert.equal((await checkTabInput(api, { id: 1, url: 'https://x.com' })).status, 'unknown');
  api.scripting.executeScript = async () => [
    { frameId: 0, result: { status: 'clear', url: 'https://changed.com', frames: 0 } },
  ];
  assert.equal((await checkTabInput(api, { id: 1, url: 'https://x.com' })).status, 'unknown');
});
test('batch checks use at most three concurrent injections', async () => {
  let active = 0,
    peak = 0;
  const api = {
    permissions: { contains: async () => true },
    scripting: {
      executeScript: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return [{ frameId: 0, result: { status: 'clear', url: 'https://x.com', frames: 0 } }];
      },
    },
  };
  const rows = await checkTabsInput(
    api,
    Array.from({ length: 20 }, (_, id) => ({ id, url: 'https://x.com' })),
  );
  assert.equal(rows.length, 20);
  assert.equal(peak, 3);
  assert(rows.every((row) => row.check.status === 'clear'));
});
