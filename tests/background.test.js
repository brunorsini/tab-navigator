import test from 'node:test';
import assert from 'node:assert/strict';
const event = () => ({
  listeners: [],
  addListener(fn) {
    this.listeners.push(fn);
  },
});
const memory = (values) => ({
  values,
  async get(key) {
    return { [key]: structuredClone(this.values[key]) };
  },
  async set(patch) {
    Object.assign(this.values, structuredClone(patch));
  },
  async remove(key) {
    delete this.values[key];
  },
});
const tabs = [1, 2, 3].map((id) => ({
  id,
  windowId: 1,
  index: id - 1,
  url: `https://example.com/${id}`,
  title: `Tab ${id}`,
  active: id === 1,
  lastAccessed: 4 - id,
}));
let active = 1,
  opened = 0,
  popupOpen = false;
globalThis.chrome = {
  runtime: {
    id: 'test',
    getURL: (path) => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: '1.5.2' }),
    getContexts: async () =>
      popupOpen
        ? [
            {
              contextType: 'POPUP',
              documentUrl: 'chrome-extension://test/popup.html?switcher&ui=1.5.2',
              windowId: 1,
            },
          ]
        : [],
    onMessage: event(),
    onConnect: event(),
    onStartup: event(),
    onInstalled: event(),
  },
  storage: { local: memory({}), session: memory({}) },
  tabs: {
    async query(query = {}) {
      return query.active ? tabs.filter((tab) => tab.id === active) : tabs;
    },
    async get(id) {
      const tab = tabs.find((tab) => tab.id === id);
      if (!tab) throw Error('missing');
      return tab;
    },
    async update(id) {
      active = id;
      tabs.forEach((tab) => {
        tab.active = tab.id === id;
      });
      return tabs.find((tab) => tab.id === id);
    },
    onActivated: event(),
    onCreated: event(),
    onRemoved: event(),
    onReplaced: event(),
    onUpdated: event(),
  },
  tabGroups: { query: async () => [] },
  commands: { getAll: async () => [], onCommand: event() },
  windows: { update: async () => {}, onFocusChanged: event(), WINDOW_ID_NONE: -1 },
  permissions: { onRemoved: event() },
  action: {
    setPopup: async () => {},
    openPopup: async () => {
      opened++;
      popupOpen = true;
    },
  },
};
await import('../extension/background.js');
const send = (message) =>
  new Promise((resolve) =>
    chrome.runtime.onMessage.listeners[0](
      message,
      { id: 'test', url: chrome.runtime.getURL('popup.html') },
      resolve,
    ),
  );
const run = async (name) => {
  const result = await send(
    name === 'confirm' ? { type: 'finish-preview', commit: true } : { type: 'command', name },
  );
  assert.equal(result.ok, true, result.error);
  if (name === 'confirm' || name === 'toggle-last') popupOpen = false;
};
test('messages from another extension cannot read snapshots or activate tabs', () => {
  const before = active;
  for (const message of [{ type: 'snapshot' }, { type: 'activate', tabId: 2 }]) {
    let responded = false;
    const handled = chrome.runtime.onMessage.listeners[0](
      message,
      { id: 'another-extension', url: 'chrome-extension://another-extension/popup.html' },
      () => {
        responded = true;
      },
    );
    assert.equal(handled, false);
    assert.equal(responded, false);
  }
  assert.equal(active, before);
});
test('website content scripts cannot invoke privileged tab actions', () => {
  const before = active;
  for (const type of ['activate', 'close-selected', 'settings', 'snapshot']) {
    let responded = false;
    const handled = chrome.runtime.onMessage.listeners[0](
      { type, tabId: 2, tabIds: [1, 2], settings: { pageText: true } },
      { id: 'test', tab: tabs[0], frameId: 0, url: tabs[0].url },
      () => {
        responded = true;
      },
    );
    assert.equal(handled, false);
    assert.equal(responded, false);
  }
  assert.equal(active, before);
});
test('command dispatcher previews forward/reverse and commits only once on Enter', async () => {
  await run('cycle-older');
  assert.equal(active, 1);
  assert.equal(opened, 1);
  assert.equal(
    chrome.storage.session.values.preview.ids[chrome.storage.session.values.preview.index],
    2,
  );
  await run('cycle-older');
  assert.equal(active, 1);
  assert.equal(
    chrome.storage.session.values.preview.ids[chrome.storage.session.values.preview.index],
    3,
  );
  await run('cycle-newer');
  assert.equal(
    chrome.storage.session.values.preview.ids[chrome.storage.session.values.preview.index],
    2,
  );
  assert.equal(opened, 1, 'keep the same popup and frozen list');
  await run('confirm');
  assert.equal(active, 2);
  await run('confirm');
  assert.equal(active, 2, 'duplicate confirmation signals must be harmless');
  await run('toggle-last');
  assert.equal(active, 1);
  await run('toggle-last');
  assert.equal(active, 2);
});
test('Escape cancellation never activates and ignores its late confirmation', async () => {
  await run('cycle-older');
  const token = chrome.storage.session.values.preview.token;
  assert.equal((await send({ type: 'finish-preview', commit: false, token })).ok, true);
  await run('confirm');
  assert.equal(active, 2);
  assert.equal(chrome.storage.session.values.preview, undefined);
});
test('stale popup disconnect cannot cancel a newer preview', async () => {
  await run('cycle-older');
  const old = chrome.storage.session.values.preview.token;
  await send({ type: 'finish-preview', commit: false, token: old });
  await run('cycle-older');
  const current = chrome.storage.session.values.preview.token;
  await send({ type: 'finish-preview', commit: false, token: old });
  assert.equal(chrome.storage.session.values.preview.token, current);
  await send({ type: 'finish-preview', commit: false, token: current });
});
test('clicking a preview row activates it and clears the preview before reopening search', async () => {
  await run('cycle-older');
  assert.equal((await send({ type: 'activate', tabId: 3 })).ok, true);
  assert.equal(active, 3);
  assert.equal(chrome.storage.session.values.preview, undefined);
});
test('closing a popup cancels even when Chrome omits the optional sender URL', async () => {
  await run('cycle-older');
  const token = chrome.storage.session.values.preview.token;
  const port = {
    name: 'palette',
    sender: { id: 'test' },
    onMessage: event(),
    onDisconnect: event(),
    postMessage() {},
  };
  chrome.runtime.onConnect.listeners[0](port);
  assert.equal(port.onMessage.listeners.length, 1);
  port.onMessage.listeners[0]({ type: 'preview-seen', token });
  port.onDisconnect.listeners[0]();
  // A subsequent command waits for the queued cancellation.
  await run('confirm');
  assert.equal(active, 3);
  assert.equal(chrome.storage.session.values.preview, undefined);
});
test('a crashed or dismissed popup cannot leave forward/back commands trapped in a hidden preview', async () => {
  await run('cycle-older');
  const old = structuredClone(chrome.storage.session.values.preview),
    before = opened,
    origin = active;
  popupOpen = false; // No preview-seen/disconnect: initialization crashed before registering handlers.
  await run('cycle-newer');
  const recovered = chrome.storage.session.values.preview;
  assert.equal(opened, before + 1, 'the next shortcut must reopen the popup immediately');
  assert.notEqual(
    recovered.token,
    old.token,
    'an invisible preview must not keep cycling silently',
  );
  assert.equal(active, origin, 'opening or recovering the switcher must not activate a tab');
  await run('confirm');
});
test('repeated commands keep a visible popup and preserve its session', async () => {
  await run('cycle-older');
  const before = opened,
    token = chrome.storage.session.values.preview.token;
  await run('cycle-older');
  await run('cycle-newer');
  assert.equal(opened, before);
  assert.equal(chrome.storage.session.values.preview.token, token);
  await run('confirm');
});
test('snapshot uses Chrome’s newer timestamp when a stored activation is stale', async () => {
  const tab = tabs.find((tab) => tab.id === active),
    recent = Date.now() - 300000;
  chrome.storage.session.values.state.seen[tab.id] = recent - 23 * 3600000;
  tab.lastAccessed = recent;
  const result = await send({ type: 'snapshot' });
  assert.equal(result.ok, true);
  assert.equal(result.data.tabs.find((row) => row.tabId === tab.id).lastAccessed, recent);
});
test('returning to a window updates last use even when the same tab is still first', async () => {
  const tab = tabs.find((tab) => tab.id === active),
    before = Date.now();
  chrome.windows.onFocusChanged.listeners[0](tab.windowId);
  await send({ type: 'finish-preview', commit: false }); // Drain queued events.
  assert(chrome.storage.session.values.state.seen[tab.id] >= before);
});
test('active same-tab navigation updates last use; background URL changes do not', async () => {
  const tab = tabs.find((tab) => tab.id === active),
    other = tabs.find((tab) => !tab.active);
  const previousOther = chrome.storage.session.values.state.seen[other.id],
    before = Date.now();
  tab.url += '#section';
  other.url += '#background';
  chrome.tabs.onUpdated.listeners[0](tab.id, { url: tab.url }, tab);
  chrome.tabs.onUpdated.listeners[0](other.id, { url: other.url }, other);
  await send({ type: 'finish-preview', commit: false });
  assert(chrome.storage.session.values.state.seen[tab.id] >= before);
  assert.equal(chrome.storage.session.values.state.seen[other.id], previousOther);
});

test('Close follows Chrome’s active tab; Restore activates the reopened tab and retains a one-shot popup highlight', async () => {
  let nextId = 100,
    focused;
  chrome.tabs.create = async (options) => {
    const tab = { id: nextId++, title: 'Restored', ...options };
    tabs.push(tab);
    return tab;
  };
  chrome.tabs.remove = async (id) => {
    tabs.splice(
      tabs.findIndex((tab) => tab.id === id),
      1,
    );
    if (active === id) await chrome.tabs.update(tabs[0].id);
  };
  chrome.windows.get = async (id) => ({ id });
  chrome.windows.update = async (id) => {
    focused = id;
  };
  for (const closeCurrent of [false, true]) {
    const original = {
      ...tabs.find((tab) => (closeCurrent ? tab.id === active : tab.id !== active)),
    };
    const before = active;
    const closed = await send({ type: 'close-selected', tabIds: [original.id] });
    assert.equal(closed.ok, true, closed.error);
    assert.equal(closed.data.count, 1);
    if (!closeCurrent) assert.equal(active, before, 'closing a background tab must not navigate');
    const afterClose = await send({ type: 'snapshot' });
    assert.equal(afterClose.data.paletteFocus.tabId, active);
    const oldToken = afterClose.data.paletteFocus.token;
    await send({ type: 'ack-palette-focus', token: 'old-popup-token' });
    assert.equal(chrome.storage.session.values.paletteFocus.token, oldToken);
    await send({ type: 'ack-palette-focus', token: oldToken });
    assert.equal(chrome.storage.session.values.paletteFocus, undefined);
    popupOpen = false;
    const restored = await send({ type: 'undo-close', id: afterClose.data.undo.at(-1).id });
    assert.equal(restored.ok, true, restored.error);
    assert.equal(restored.data.count, 1);
    assert.equal(active, restored.data.tabId);
    assert.equal(focused, original.windowId);
    assert.equal(tabs.find((tab) => tab.id === active).url, original.url);
    const reopened = await send({ type: 'snapshot' });
    assert.equal(reopened.data.paletteFocus.tabId, active);
    assert.notEqual(reopened.data.paletteFocus.token, oldToken);
    assert.equal(chrome.storage.session.values.state.order[0], active);
  }
});
test('activation failure reports restored tabs honestly and does not make Undo duplicate them', async () => {
  const original = tabs.find((tab) => tab.id !== active);
  await send({ type: 'close-selected', tabIds: [original.id] });
  const before = await send({ type: 'snapshot' }),
    update = chrome.tabs.update;
  chrome.tabs.update = async () => {
    throw Error('focus failed');
  };
  try {
    const restored = await send({ type: 'undo-close', id: before.data.undo.at(-1).id });
    assert.equal(restored.ok, true);
    assert.equal(restored.data.count, 1);
    assert.equal(restored.data.failed, 0);
    assert.match(restored.data.activationError, /restored.*could not bring/);
    assert.equal(tabs.filter((tab) => tab.url === original.url).length, 1);
    assert.equal((await send({ type: 'snapshot' })).data.undo.length, 0);
  } finally {
    chrome.tabs.update = update;
  }
});
