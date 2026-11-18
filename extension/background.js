import { reconcile, touch, removeTab } from './lib/state.js';
import { stepPreview } from './lib/preview.js';
import { bulkActions } from './lib/bulk.js';
import { openSplitView } from './lib/split-view.js';

const bulk = bulkActions(chrome);
const popupPath = `popup.html?ui=${chrome.runtime.getManifest().version}`;
const palettes = new Set();
async function finishPreview(commit = false, token) {
  const { preview } = await chrome.storage.session.get('preview');
  if (!preview || (token && token !== preview.token)) return;
  await chrome.storage.session.remove('preview');
  for (const port of palettes) {
    try {
      port.postMessage({ type: 'preview-ended', token: preview.token });
    } catch {}
  }
  if (commit) await activate(preview.ids[preview.index]);
}
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'palette' ||
    port.sender?.id !== chrome.runtime.id ||
    (port.sender.tab && !port.sender.url?.startsWith(chrome.runtime.getURL('')))
  )
    return;
  palettes.add(port);
  let token;
  port.onMessage.addListener((message) => {
    if (message.type === 'preview-seen') token = message.token;
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    palettes.delete(port);
    if (token) serial(() => finishPreview(false, token));
  });
});

const DEFAULTS = { currentWindow: false, pageText: false, theme: 'dark' };
const ORIGINS = ['http://*/*', 'https://*/*'];
let queue = Promise.resolve();
// Every mutation goes through one queue; storage.session survives service-worker suspension.
function serial(task) {
  const run = queue.then(task);
  queue = run.catch((error) => console.warn('Tab Navigator:', error.message));
  return run;
}
async function settings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return Object.fromEntries(
    Object.entries(DEFAULTS).map(([key, value]) => [key, settings[key] ?? value]),
  );
}
async function loadState() {
  const [saved, tabs] = await Promise.all([
    chrome.storage.session.get('state'),
    chrome.tabs.query({}),
  ]);
  return {
    state: reconcile(
      saved.state,
      tabs.filter((tab) => !tab.incognito),
    ),
    tabs: tabs.filter((tab) => !tab.incognito),
  };
}
const saveState = (state) => chrome.storage.session.set({ state });

async function activate(id, preserveCycle = false) {
  const tab = await chrome.tabs.get(id);
  if (tab.incognito) throw new Error('Private tabs are not available in Tab Navigator.');
  const { state } = await loadState();
  const previous = state.order[0];
  const previousSeen = state.seen[id];
  touch(state, id, Date.now(), preserveCycle);
  await saveState(state);
  const { expectedActivations = [] } = await chrome.storage.session.get('expectedActivations');
  if (!tab.active)
    await chrome.storage.session.set({
      expectedActivations: [
        ...expectedActivations.filter((event) => Date.now() - event.at < 3000),
        { id, at: Date.now() },
      ],
    });
  try {
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    await chrome.storage.session.set({
      expectedActivations: expectedActivations.filter((event) => event.id !== id),
    });
    if (previous !== undefined) touch(state, previous);
    state.seen[id] = previousSeen || 0;
    await saveState(state);
    throw error;
  }
}

async function command(name) {
  const { state, tabs } = await loadState();
  const prefs = await settings();
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!current || current.incognito) return;
  const eligible = tabs
    .filter(
      (tab) =>
        !tab.url?.startsWith(chrome.runtime.getURL('')) &&
        (!prefs.currentWindow || tab.windowId === current.windowId),
    )
    .map((tab) => tab.id);
  if (name === 'toggle-last') {
    await finishPreview(false);
    const target = state.order.find((id) => id !== current.id && eligible.includes(id));
    if (target != null) await activate(target);
    return;
  }
  const saved = await chrome.storage.session.get('preview');
  // A saved session is not evidence that its popup is still open. Initialization
  // errors and worker restarts can lose the disconnect that normally clears it.
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
  const popupVisible = contexts.some(
    (context) => context.documentUrl?.split('?')[0] === chrome.runtime.getURL('popup.html'),
  );
  const previous = popupVisible ? saved.preview : null;
  const preview = stepPreview(
    previous,
    state.order,
    current.id,
    eligible,
    name === 'cycle-older' ? 1 : -1,
  );
  if (!preview) return;
  await chrome.storage.session.set({ preview });
  if (!popupVisible) {
    try {
      await chrome.action.setPopup({ popup: `${popupPath}&switcher` });
      await chrome.action.openPopup({ windowId: current.windowId });
    } catch (error) {
      await finishPreview(false);
      throw error;
    } finally {
      await chrome.action.setPopup({ popup: popupPath });
    }
  }
}

async function snapshot() {
  const [{ state, tabs }, prefs, contexts, groups, active, commands] = await Promise.all([
    loadState(),
    settings(),
    chrome.storage.session.get('contexts'),
    chrome.tabGroups.query({}),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    chrome.commands.getAll(),
  ]);
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  const { preview } = await chrome.storage.session.get('preview');
  const { paletteFocus } = await chrome.storage.session.get('paletteFocus');
  return {
    version: chrome.runtime.getManifest().version,
    closeReviewVersion: 1,
    canSplit: typeof chrome.tabs.createSplit === 'function',
    settings: prefs,
    currentId: active[0]?.id,
    windowId: active[0]?.windowId,
    commands,
    preview,
    paletteFocus,
    undo: await bulk.undoInfo(),
    groups: groups.map(({ id, title, windowId }) => ({ id, title, windowId })),
    tabs: tabs
      .filter((tab) => !tab.url?.startsWith(chrome.runtime.getURL('')))
      .map((tab) => {
        const context = contexts.contexts?.[tab.id];
        const validContext = prefs.pageText && context?.url === tab.url ? context : {};
        return {
          kind: 'tab',
          id: `tab-${tab.id}`,
          tabId: tab.id,
          windowId: tab.windowId,
          index: tab.index,
          groupId: tab.groupId,
          splitViewId: tab.splitViewId,
          title: tab.title || tab.url || 'Untitled tab',
          url: tab.url || tab.pendingUrl || '',
          group: groupMap.get(tab.groupId)?.title || '',
          groupColor: groupMap.get(tab.groupId)?.color,
          pinned: tab.pinned,
          audible: tab.audible,
          discarded: tab.discarded,
          active: tab.active,
          pendingUrl: tab.pendingUrl,
          lastAccessed: state.seen[tab.id] || tab.lastAccessed || 0,
          createdAt: state.created[tab.id] || 0,
          description: validContext.description,
          headings: validContext.headings,
          text: validContext.text,
          contextIndexed: Boolean(validContext.url),
          contextTruncated: Boolean(validContext.truncated),
        };
      }),
  };
}

async function historySearch(query = '') {
  const cleaned = String(query).slice(0, 200).replace(/^"|"$/g, '').trim();
  if (!cleaned) return [];
  const terms = [...new Set([cleaned, ...cleaned.split(/\s+/).slice(0, 3)])];
  const batches = await Promise.all(
    terms.map((text) => chrome.history.search({ text, startTime: 0, maxResults: 400 })),
  );
  const unique = new Map();
  for (const item of batches.flat()) {
    if (!/^https?:\/\//.test(item.url || '')) continue;
    unique.set(item.url, {
      kind: 'history',
      id: `history-${item.id}`,
      title: item.title || item.url,
      url: item.url,
      lastAccessed: item.lastVisitTime || 0,
    });
  }
  return [...unique.values()];
}

async function configureContext() {
  const prefs = await settings();
  const allowed = await chrome.permissions.contains({ origins: ORIGINS });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: ['relay-context'] });
  if (prefs.pageText && allowed) {
    if (!existing.length)
      await chrome.scripting.registerContentScripts([
        {
          id: 'relay-context',
          matches: ORIGINS,
          js: ['context.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    const tabs = await chrome.tabs.query({ url: ORIGINS, discarded: false });
    // Sequential injection bounds the temporary workload when many tabs are open.
    for (const tab of tabs)
      if (!tab.incognito) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['context.js'],
          });
        } catch {
          /* Restricted site. */
        }
      }
  } else {
    if (existing.length)
      await chrome.scripting.unregisterContentScripts({ ids: ['relay-context'] });
    await chrome.storage.session.remove('contexts');
    const tabs = await chrome.tabs.query({ url: ORIGINS });
    await Promise.allSettled(
      tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'stop-context' })),
    );
    if (prefs.pageText) await chrome.storage.local.set({ settings: { ...prefs, pageText: false } });
  }
}

async function capture(message, sender) {
  if (
    !sender.tab ||
    sender.tab.incognito ||
    sender.frameId !== 0 ||
    !/^https?:\/\//.test(sender.url || '')
  )
    return;
  if (!(await settings()).pageText) return;
  const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);
  if (!tab || tab.url !== message.url || sender.url !== message.url) return;
  const { contexts = {} } = await chrome.storage.session.get('contexts');
  contexts[tab.id] = {
    url: tab.url,
    description: String(message.description || '').slice(0, 600),
    headings: String(message.headings || '').slice(0, 1800),
    text: String(message.text || '').slice(0, 200000),
    truncated: Boolean(message.truncated),
    at: Date.now(),
  };
  let characters = 0;
  const entries = Object.entries(contexts)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 350)
    .filter(([, context]) => {
      characters += context.text.length + context.headings.length + context.description.length;
      return characters <= 2000000;
    });
  await chrome.storage.session.set({ contexts: Object.fromEntries(entries) });
}

async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.incognito) return;
  // Survives a popup that Chrome dismisses when its active tab closes/changes.
  await chrome.storage.session.set({
    paletteFocus: { token: crypto.randomUUID(), tabId: tab.id, at: Date.now() },
  });
}
async function closeAndFollow(ids) {
  const result = await bulk.closeSelected(ids);
  if (result.count) await followActiveTab().catch(() => {});
  return result;
}
async function restoreAndActivate(id) {
  const result = await bulk.undo(id);
  if (Number.isInteger(result.tabId)) {
    try {
      await activate(result.tabId);
      await followActiveTab();
    } catch {
      result.activationError =
        'The tabs were restored, but Chrome could not bring the restored tab into view.';
    }
  }
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === 'context') {
    serial(() => capture(message, sender)).then(
      () => respond({ ok: true }),
      () => respond({ ok: false }),
    );
    return true;
  }
  // Only our own extension pages can activate tabs or change settings.
  if (sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  const handlers = {
    snapshot,
    command: () => runCommand(message.name),
    'finish-preview': () => serial(() => finishPreview(Boolean(message.commit), message.token)),
    'prepare-close': () => serial(() => bulk.prepareClose(message.tabIds, message.keepers)),
    'close-one': () => serial(() => closeAndFollow([message.tabId])),
    'close-selected': () => serial(() => closeAndFollow(message.tabIds)),
    'close-tabs': () =>
      serial(() =>
        bulk.close(message.tabIds, { token: message.token, acknowledged: message.acknowledged }),
      ),
    'undo-close': () => serial(() => restoreAndActivate(message.id)),
    'ack-palette-focus': () =>
      serial(async () => {
        const { paletteFocus } = await chrome.storage.session.get('paletteFocus');
        if (paletteFocus?.token === message.token)
          await chrome.storage.session.remove('paletteFocus');
      }),
    'group-tabs': () => serial(() => bulk.group(message.tabIds, message.groupId, message.title)),
    'split-tabs': () => serial(() => openSplitView(chrome, message.tabIds)),
    'bookmark-folders': () => bulk.folders(),
    'bookmark-tabs': () =>
      serial(() => bulk.bookmark(message.tabIds, message.folderId, message.title)),
    'bookmark-draft': () => serial(() => bulk.bookmarkDraft(message.id)),
    history: () => historySearch(message.query),
    activate: () =>
      serial(async () => {
        await activate(Number(message.tabId));
        await finishPreview(false);
      }),
    'open-history': () =>
      serial(async () => {
        if (!/^https?:\/\//.test(message.url || ''))
          throw new Error('This address cannot be opened.');
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find((tab) => tab.url === message.url && !tab.incognito);
        if (existing) await activate(existing.id);
        else await chrome.tabs.create({ url: message.url });
      }),
    settings: () =>
      serial(async () => {
        const old = await settings();
        const next = { ...old };
        for (const key of ['currentWindow', 'pageText'])
          if (typeof message.settings?.[key] === 'boolean') next[key] = message.settings[key];
        if (['dark', 'light', 'system', 'chartroom', 'midnight'].includes(message.settings?.theme))
          next.theme = message.settings.theme;
        if (next.pageText && !(await chrome.permissions.contains({ origins: ORIGINS })))
          next.pageText = false;
        await chrome.storage.local.set({ settings: next });
        if (next.pageText !== old.pageText) await configureContext();
        return next;
      }),
    'clear-context': () => serial(() => chrome.storage.session.remove('contexts')),
    shortcuts: () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }),
  };
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(handler)
    .then(
      (data) => respond({ ok: true, data }),
      (error) => respond({ ok: false, error: error.message }),
    );
  return true;
});

function runCommand(name) {
  if (['toggle-last', 'cycle-older', 'cycle-newer'].includes(name))
    return serial(() => command(name));
}
chrome.commands.onCommand.addListener((name) => runCommand(name)?.catch(console.warn));
chrome.tabs.onActivated.addListener(({ tabId }) =>
  serial(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.incognito) return;
    const { expectedActivations = [] } = await chrome.storage.session.get('expectedActivations');
    const pending = expectedActivations.filter((event) => Date.now() - event.at < 3000);
    const index = pending.findIndex((event) => event.id === tabId);
    if (index >= 0) {
      pending.splice(index, 1);
      await chrome.storage.session.set({ expectedActivations: pending });
      return; // The command already recorded this visit; do not reorder delayed events.
    }
    if (!tab.active) return;
    await finishPreview(false);
    const { state } = await loadState();
    touch(state, tabId);
    await saveState(state);
  }),
);
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  serial(async () => {
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    if (!tab || tab.incognito) return;
    const { state } = await loadState();
    touch(state, tab.id);
    await saveState(state);
  });
});
chrome.tabs.onCreated.addListener((tab) =>
  serial(async () => {
    if (tab.incognito) return;
    const { state } = await loadState();
    state.created[tab.id] = Date.now();
    state.seen[tab.id] = Date.now();
    if (tab.active) touch(state, tab.id);
    await saveState(state);
  }),
);
const removedTabs = new Set();
let removalQueued = false;
chrome.tabs.onRemoved.addListener((id) => {
  removedTabs.add(id);
  if (removalQueued) return;
  removalQueued = true;
  serial(async () => {
    const ids = [...removedTabs];
    removedTabs.clear();
    removalQueued = false;
    const { state } = await loadState();
    for (const id of ids) removeTab(state, id);
    await saveState(state);
    const { contexts = {} } = await chrome.storage.session.get('contexts');
    for (const id of ids) delete contexts[id];
    await chrome.storage.session.set({ contexts });
  });
});
chrome.tabs.onReplaced.addListener((added, removed) =>
  serial(async () => {
    const { state = {} } = await chrome.storage.session.get('state');
    if (state.order) state.order = state.order.map((id) => (id === removed ? added : id));
    for (const field of ['seen', 'created'])
      if (state[field]) {
        state[field][added] = state[field][removed];
        delete state[field][removed];
      }
    state.cycle = null;
    await saveState(state);
  }),
);
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (!change.url && change.status !== 'loading') return;
  serial(async () => {
    const { contexts = {} } = await chrome.storage.session.get('contexts');
    if (contexts[id]) {
      delete contexts[id];
      await chrome.storage.session.set({ contexts });
    }
    // Visiting another URL (including a section) in the selected tab is use,
    // even though Chrome only updates lastAccessed when the tab is activated.
    if (change.url && tab?.active && !tab.incognito) {
      const { state } = await loadState();
      touch(state, id);
      await saveState(state);
    }
  });
});
chrome.permissions.onRemoved.addListener(() => serial(configureContext));
chrome.runtime.onStartup.addListener(() =>
  serial(async () => {
    const { state } = await loadState();
    await saveState(state);
    await configureContext();
  }),
);
chrome.runtime.onInstalled.addListener((details) =>
  serial(async () => {
    if (details.reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('tour.html') });
    }
    const { state } = await loadState();
    await saveState(state);
    await configureContext();
  }),
);
