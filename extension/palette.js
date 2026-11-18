import { prepare, rank, combine, displayUrl, excerpt } from './lib/search.js';
import { highlightRanges } from './lib/highlight.js';
import { recency } from './lib/recency.js';
import { splitAvailability } from './lib/split-view.js';
import { createUndoBars } from './lib/undo-bars.js';
import { request, applyTheme, shortcutLabel } from './lib/client.js';
import { createBookmarkDraft, pendingBookmarkDraft } from './lib/bookmark-draft.js';
import { palettePort } from './lib/palette-port.js';
import { draftKey } from './lib/bookmark-draft.js';
import {
  ROW_HEIGHT,
  groupResults,
  stabilizeResults,
  selectedAfterUpdate,
  resultLayout,
  visibleRange,
} from './lib/result-view.js';
const $ = (id) => document.getElementById(id);
const input = $('search');
const uiBuild = new URL(import.meta.url).searchParams.get('ui');
const selectionKey = /Mac/.test(navigator.platform) ? '⌘ ↵' : 'Ctrl ↵';
$('selection-shortcut').textContent = selectionKey;
// Each opening starts with the user's main job: finding an open tab.
const sources = { tabs: true, history: false };
let data,
  tabs = [],
  history = [],
  results = [],
  selected = 0,
  selectionMoved = false,
  searchVersion = 0,
  timer,
  refreshTimer,
  opening = false;
let groupByDomain = true,
  orderHeld = false,
  refreshVersion = 0,
  layout = resultLayout([]);
let windowScopeVersion = 0;
let appliedFocusToken, followedTabId;
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};
function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}
function siteIcon(item) {
  const host = displayUrl(item.url).split('/')[0];
  const icon = node('span', `site-icon${item.kind === 'history' ? ' history-icon' : ''}`);
  icon.setAttribute('aria-hidden', 'true');
  const fallback = node(
    'span',
    'icon-fallback',
    item.kind === 'history' ? '↶' : (host || item.title || '?')[0].toUpperCase(),
  );
  icon.append(fallback);
  if (!/^(https?|file|chrome):\/\//.test(item.url)) return icon;
  // Chrome serves this from its local favicon database. Never load a site's
  // favIconUrl directly: reopening search must not contact all those websites.
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', item.url);
  url.searchParams.set('size', '32');
  const img = node('img', 'favicon');
  img.alt = '';
  img.width = 18;
  img.height = 18;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.addEventListener(
    'load',
    () => {
      fallback.hidden = true;
      img.classList.add('loaded');
      icon.classList.add('has-favicon');
    },
    { once: true },
  );
  img.addEventListener(
    'error',
    () => {
      img.remove();
      fallback.hidden = false;
      icon.classList.remove('has-favicon');
    },
    { once: true },
  );
  img.src = url.href;
  icon.append(img);
  return icon;
}
function highlight(text, query) {
  const frag = document.createDocumentFragment();
  const ranges = highlightRanges(text, query);
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    frag.append(
      document.createTextNode(text.slice(cursor, start)),
      node('mark', '', text.slice(start, end)),
    );
    cursor = end;
  }
  frag.append(document.createTextNode(text.slice(cursor)));
  return frag;
}
function syncFilters() {
  for (const key of ['tabs', 'history'])
    $(`${key}-filter`).setAttribute('aria-pressed', String(sources[key]));
  $('window-filter').setAttribute('aria-pressed', String(data.settings.currentWindow));
  $('window-filter').firstChild.textContent = data.settings.currentWindow
    ? 'This window '
    : 'All windows ';
  $('tab-count').textContent = tabs.filter(
    (tab) => !data.settings.currentWindow || tab.windowId === data.windowId,
  ).length;
  $('domain-filter').setAttribute('aria-pressed', String(groupByDomain));
}
async function syncWindowScope() {
  const version = ++windowScopeVersion;
  try {
    // Count browser windows, not DevTools, app windows, or inaccessible private windows.
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (version !== windowScopeVersion) return;
    const button = $('window-filter');
    button.hidden = windows.filter((window) => !window.incognito).length <= 1;
    if (button.hidden && document.activeElement === button) input.focus();
  } catch {
    /* Keep the last known visibility if Chrome is temporarily unavailable. */
  }
}
let preview = null,
  renderedStart = -1,
  busy = false,
  action = null,
  actionIds = [];
const undoBars = createUndoBars($('undo-bars'), { restore: restoreBatch });
function syncOrderHint() {
  $('order-hint').textContent = preview
    ? 'Most recent first'
    : input.value.trim()
      ? 'Exact first · then recent'
      : 'Most recent first';
}
function holdOrder() {
  if (preview || !results.length) return;
  orderHeld = true;
  selectionMoved = true;
  syncOrderHint();
}
function releaseOrder() {
  orderHeld = false;
  selectionMoved = false;
  followedTabId = undefined;
}
const picked = new Set();
const port = palettePort(chrome.runtime, (message) => {
  if (message.type === 'preview-ended' && preview?.token === message.token) window.close();
});
function render(reset = true) {
  if (!data) return;
  const query = preview ? '' : input.value;
  const previous = results[selected]?.id;
  const scopedTabs = tabs.filter(
    (tab) => !data.settings.currentWindow || tab.windowId === data.windowId,
  );
  if (preview) {
    const map = new Map(tabs.map((tab) => [tab.tabId, tab]));
    results = preview.ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((item) => ({ ...item, match: {} }));
    selected = Math.max(
      0,
      results.findIndex((item) => item.tabId === preview.ids[preview.index]),
    );
  } else {
    const ranked = rank(
      combine(scopedTabs, history, sources.tabs, sources.history && Boolean(query.trim())),
      query,
      { currentId: data.currentId },
    );
    results = stabilizeResults(results, groupResults(ranked, query, groupByDomain), orderHeld);
    selected = reset ? 0 : selectedAfterUpdate(results, previous, selected);
    orderHeld = true;
  }
  const follow = followActionFocus();
  layout = resultLayout(results);
  const available = new Set(
    results.filter((item) => item.kind === 'tab').map((item) => item.tabId),
  );
  for (const id of picked) if (!available.has(id)) picked.delete(id);
  $('clear').hidden = !query;
  $('search-shortcut').hidden = Boolean(query);
  $('result-label').textContent = preview
    ? 'RECENT TABS'
    : query
      ? 'BEST MATCHES'
      : sources.tabs
        ? 'RECENT TABS'
        : 'SEARCH HISTORY';
  syncOrderHint();
  $('order-hint').hidden = !preview && !query && !sources.tabs;
  const tabCount = available.size,
    historyCount = results.length - tabCount;
  $('result-total').textContent = preview
    ? `${selected + 1} / ${results.length}`
    : `${tabCount.toLocaleString()} ${query ? 'matching ' : ''}tabs${historyCount ? ` · ${historyCount.toLocaleString()} history results*` : ''}`;
  $('result-total').title = sources.history
    ? 'Tab count is complete. History results are limited to the candidates returned by Chrome.'
    : 'Every matching open tab is counted and selectable.';
  $('empty').hidden = results.length > 0;
  $('results').hidden = !results.length;
  if (!results.length) {
    const none = !sources.tabs && !sources.history;
    const historyOnly = !sources.tabs && sources.history && !query.trim();
    $('empty-title').textContent = none
      ? 'Choose where to look.'
      : historyOnly
        ? 'What are you looking for?'
        : query
          ? 'No matching pages.'
          : 'A little space to think.';
    $('empty-message').textContent = none
      ? 'Turn on Tabs, History, or both to start searching.'
      : historyOnly
        ? 'Type a title, website, or phrase to search your history.'
        : query
          ? 'Try a title, a website, or a few words you remember. Use quotes for an exact phrase.'
          : 'Your open tabs will appear here.';
  }
  if (reset) $('results').scrollTop = 0;
  syncFilters();
  syncSelection();
  syncUndo();
  renderRows(true);
  setSelected(selected, Boolean(preview) || follow);
}
function followActionFocus() {
  const target = data?.paletteFocus;
  let scroll = false;
  if (!preview && target && target.token !== appliedFocusToken) {
    appliedFocusToken = target.token;
    if (Date.now() - target.at < 60_000 && target.tabId === data.currentId) {
      followedTabId = target.tabId;
      const index = results.findIndex((item) => item.kind === 'tab' && item.tabId === target.tabId);
      if (index !== -1) {
        selected = index;
        scroll = true;
      }
    }
    request('ack-palette-focus', { token: target.token }).catch(() => {});
  }
  const outside =
    !preview &&
    followedTabId != null &&
    followedTabId === data?.currentId &&
    !results.some((item) => item.kind === 'tab' && item.tabId === followedTabId);
  $('current-tab-notice').textContent = outside ? 'Current tab isn’t in these search results.' : '';
  $('current-tab-notice').hidden = !outside;
  return scroll;
}
function renderRows(force = false) {
  const list = $('results');
  const { start, end } = visibleRange(layout, list.scrollTop, list.clientHeight || 350);
  const range = `${start}:${end}`;
  if (!force && range === renderedStart) return;
  renderedStart = range;
  const fragment = document.createDocumentFragment();
  const before = node('div');
  before.style.height = `${layout.entries[start]?.top || 0}px`;
  before.setAttribute('aria-hidden', 'true');
  fragment.append(before);
  layout.entries.slice(start, end).forEach((entry) => {
    if (entry.type === 'heading') {
      const heading = node('div', 'domain-heading');
      heading.setAttribute('role', 'presentation');
      heading.append(
        node('span', '', entry.label),
        node('span', 'domain-count', entry.count.toLocaleString()),
      );
      fragment.append(heading);
      return;
    }
    const index = entry.index,
      item = results[index],
      query = preview ? '' : input.value;
    const row = node('div', 'result');
    row.id = `result-${index}`;
    row.dataset.index = index;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(index === selected));
    row.setAttribute('aria-posinset', index + 1);
    row.setAttribute('aria-setsize', results.length);
    const icon = siteIcon(item),
      copy = node('div', 'result-copy');
    const title = node('div', 'result-title');
    title.append(highlight(item.title, query));
    const meta = node('div', 'result-meta');
    const url = node('span', 'result-url');
    url.append(highlight(displayUrl(item.url), query));
    meta.append(url);
    if (item.group) meta.append(node('span', 'meta-tag', item.group));
    if (item.pinned) meta.append(node('span', 'meta-tag', 'Pinned'));
    if (item.audible) meta.append(node('span', 'meta-tag', 'Playing'));
    copy.append(title, meta);
    if (item.match.reason && query) {
      const context = node('div', 'match-context');
      context.append(node('span', 'match-label', item.match.reason));
      if (/Page|Description/.test(item.match.reason)) {
        const snippet = excerpt(item, query);
        if (snippet) {
          context.append(document.createTextNode(' · '), highlight(snippet, query));
        }
      }
      copy.append(context);
    }
    if (!preview && item.kind === 'tab') {
      const check = node('button', 'pick-tab', picked.has(item.tabId) ? '✓' : '');
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', String(picked.has(item.tabId)));
      check.setAttribute(
        'aria-label',
        `${picked.has(item.tabId) ? 'Deselect' : 'Select'} ${item.title}`,
      );
      check.disabled = busy;
      check.title = `${selectionKey} checks or unchecks the highlighted tab`;
      check.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePicked(item.tabId);
      });
      row.append(check);
    }
    const tail = node('div', 'result-end');
    const when = recency(item.lastAccessed, {
      current: item.kind === 'tab' && item.tabId === data.currentId,
    });
    const time = node('time', `recency recency--${when.tone}`, when.label);
    time.title = when.title;
    if (when.dateTime) time.setAttribute('datetime', when.dateTime);
    const details = node('div', 'result-status');
    if (item.kind === 'history') details.append(node('span', 'result-tag', 'History'));
    details.append(time);
    const rowActions = node('div', 'row-actions');
    rowActions.append(node('span', 'enter-key', '↵'));
    if (!preview && item.kind === 'tab') {
      const close = node('button', 'icon-button row-close', '×');
      close.title = 'Close tab · Undo available';
      close.setAttribute('aria-label', `Close ${item.title}`);
      close.disabled = busy;
      close.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      });
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        closeSingleTab(item.tabId);
      });
      rowActions.append(close);
    }
    tail.append(details, rowActions);
    row.append(icon, copy, tail);
    row.title = `${item.title}\n${item.url}${item.group ? `\nGroup: ${item.group}` : ''}`;
    row.addEventListener('click', (event) => {
      if (busy) return;
      if (!preview && item.kind === 'tab' && (event.metaKey || event.ctrlKey))
        togglePicked(item.tabId);
      else open(index);
    });
    fragment.append(row);
  });
  const after = node('div');
  after.style.height = `${layout.height - (layout.entries[end]?.top ?? layout.height)}px`;
  after.setAttribute('aria-hidden', 'true');
  fragment.append(after);
  list.replaceChildren(fragment);
}
function setSelected(index, scroll = true) {
  if (!results.length) {
    input.removeAttribute('aria-activedescendant');
    return;
  }
  selected = (index + results.length) % results.length;
  if (scroll) {
    selectionMoved = true;
    const list = $('results'),
      top = layout.tops[selected];
    const headingTop =
      results[selected].section &&
      (selected === 0 || results[selected - 1].section?.key !== results[selected].section.key)
        ? top - 30
        : top;
    if (headingTop < list.scrollTop) list.scrollTop = headingTop;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight)
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    renderRows();
  }
  for (const row of $('results').querySelectorAll('[data-index]'))
    row.setAttribute('aria-selected', String(Number(row.dataset.index) === selected));
  input.setAttribute('aria-activedescendant', `result-${selected}`);
  $('enter-label').textContent = results[selected].kind === 'tab' ? 'switch to tab' : 'open page';
}
$('results').addEventListener('scroll', () => requestAnimationFrame(() => renderRows()), {
  passive: true,
});
for (const type of ['wheel', 'touchstart', 'pointerdown'])
  $('results').addEventListener(type, holdOrder, { passive: true });
new ResizeObserver(() => renderRows(true)).observe($('results'));
function togglePicked(id) {
  if (busy) return;
  holdOrder();
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  syncSelection();
  renderRows(true);
  setSelected(selected);
  input.focus();
}
function syncSelection() {
  const count = results.filter((item) => item.kind === 'tab').length;
  $('select-all').textContent = `Select all ${count.toLocaleString()} tabs`;
  $('select-all').disabled = !count || busy;
  $('selection-count').textContent = picked.size ? `${picked.size.toLocaleString()} selected` : '';
  $('clear-selection').hidden = !picked.size;
  $('bulk-bar').hidden = !picked.size;
  for (const id of ['close-tabs', 'group-tabs', 'bookmark-tabs', 'clear-selection'])
    $(id).disabled = busy;
  $('close-tabs').textContent =
    `Close ${picked.size.toLocaleString()} ${picked.size === 1 ? 'tab' : 'tabs'}`;
  const reason = splitAvailability(
    tabs.filter((tab) => picked.has(tab.tabId)),
    Boolean(data?.canSplit),
  );
  $('split-tabs').disabled = busy || Boolean(reason);
  $('split-tabs').title =
    reason || 'Show these 2 tabs side by side in Chrome. They will be placed next to each other.';
  $('split-hint').textContent = reason;
  $('split-hint').hidden = !picked.size || !reason;
}
function syncUndo() {
  undoBars.set(data?.undo, { disabled: busy, hidden: Boolean(preview) });
}
function setPreview(value) {
  preview = value || null;
  document.body.classList.toggle('is-switcher', Boolean(preview));
  $('switcher-heading').hidden = !preview;
  if (preview) {
    const nativeAlt = /Alt|⌥/.test(
      data?.commands.find((command) => command.name === 'cycle-older')?.shortcut || '',
    );
    $('switcher-instructions').textContent = nativeAlt
      ? 'Repeat the cycle shortcut · Shift reverses'
      : '⌘ ⌥ Tab moves down · Add Shift to move up';
    $('switcher-finish').textContent = 'Enter switches to the highlighted tab · Esc cancels';
    picked.clear();
    closeAction();
    port.send({ type: 'preview-seen', token: preview.token });
  }
}
$('cancel-preview').addEventListener('click', () => finishPreview(false));
function closePalette() {
  // Closing the UI must never depend on a working background connection.
  if (preview) request('finish-preview', { commit: false, token: preview.token }).catch(() => {});
  window.close();
}
$('close-palette').addEventListener('click', closePalette);
async function finishPreview(commit) {
  if (!preview) return;
  if (!commit) {
    closePalette();
    return;
  }
  try {
    await request('finish-preview', { commit, token: preview.token });
    window.close();
  } catch (error) {
    notice(error.message);
  }
}
function closeAction() {
  $('action-panel').hidden = true;
  action = null;
  input.focus();
}
async function closeSingleTab(tabId) {
  return closeSelectedTabs([tabId]);
}
async function closeSelectedTabs(tabIds) {
  if (busy || action || !tabIds.length) return;
  holdOrder();
  busy = true;
  syncSelection();
  syncUndo();
  renderRows(true);
  try {
    const result = await request('close-selected', { tabIds });
    // The Undo bars are the success feedback; keep notices for partial failures.
    notice(
      result.skipped
        ? `${result.skipped} ${result.skipped === 1 ? 'tab stayed' : 'tabs stayed'} open because they changed or could not be closed.`
        : '',
    );
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    await refresh();
  }
}
function showAction(kind, folders = []) {
  if (!picked.size || busy) return;
  action = kind;
  actionIds = [...picked];
  $('action-cancel').textContent = 'Cancel';
  const count = actionIds.length.toLocaleString();
  $('action-title').textContent =
    kind === 'group' ? `Group ${count} tabs` : `Bookmark ${count} tabs`;
  $('action-description').textContent =
    kind === 'group'
      ? 'A new group is created in each affected window. Choosing an existing group moves selected tabs into its window.'
      : 'Choose an existing folder, or enter a name to create a subfolder. Duplicate addresses in that folder are skipped.';
  $('destination-label').hidden = false;
  $('new-name-label').hidden = false;
  $('destination').replaceChildren();
  if (kind === 'group') {
    const fresh = node('option', '', 'New group in each window');
    fresh.value = '';
    $('destination').append(fresh);
    for (const group of data.groups) {
      const option = node(
        'option',
        '',
        `${group.title || 'Unnamed group'} · window ${group.windowId}`,
      );
      option.value = group.id;
      $('destination').append(option);
    }
  } else
    for (const folder of folders) {
      const option = node('option', '', folder.title);
      option.value = folder.id;
      $('destination').append(option);
    }
  $('new-name').value = '';
  $('new-name').placeholder = kind === 'group' ? 'Group name' : 'New subfolder (optional)';
  $('action-confirm').textContent = kind === 'group' ? 'Add to group' : 'Save bookmarks';
  $('action-error').textContent = '';
  $('action-panel').hidden = false;
  $('destination').focus();
}
$('select-all').addEventListener('click', () => {
  holdOrder();
  for (const item of results) if (item.kind === 'tab') picked.add(item.tabId);
  syncSelection();
  renderRows(true);
});
$('clear-selection').addEventListener('click', () => {
  picked.clear();
  syncSelection();
  renderRows(true);
});
$('close-tabs').addEventListener('click', () => closeSelectedTabs([...picked]));
$('duplicates').addEventListener('click', () => openReview());
async function openReview(ids) {
  try {
    const token = crypto.randomUUID();
    if (ids)
      await chrome.storage.session.set({ [`review-request:${token}`]: { ids, at: Date.now() } });
    await chrome.tabs.create({
      url: chrome.runtime.getURL(
        `review.html?from=${data.currentId || ''}${ids ? `&selection=${token}` : ''}`,
      ),
    });
    window.close();
  } catch (error) {
    notice(error.message);
  }
}
$('group-tabs').addEventListener('click', () => showAction('group'));
$('split-tabs').addEventListener('click', async () => {
  if (busy || $('split-tabs').disabled) return;
  busy = true;
  syncSelection();
  try {
    await request('split-tabs', { tabIds: [...picked] });
    window.close();
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    await refresh();
  }
});
$('bookmark-tabs').addEventListener('click', async () => {
  try {
    const draft = await createBookmarkDraft(
      chrome,
      results.filter((tab) => picked.has(tab.tabId)),
    );
    await chrome.tabs.create({ url: chrome.runtime.getURL(`bookmarks.html?draft=${draft.id}`) });
    window.close();
  } catch (error) {
    notice(error.message);
  }
});
let pendingBookmark;
$('bookmark-resume').addEventListener('click', async () => {
  if (!pendingBookmark) return;
  try {
    const url = chrome.runtime.getURL(`bookmarks.html?draft=${pendingBookmark.id}`);
    const existing = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    if (existing) {
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.windows.update(existing.windowId, { focused: true });
    } else await chrome.tabs.create({ url });
    window.close();
  } catch (error) {
    notice(error.message);
  }
});
pendingBookmarkDraft(chrome)
  .then((draft) => {
    pendingBookmark = draft;
    $('bookmark-resume-bar').hidden = !draft;
    if (draft)
      $('bookmark-resume-label').textContent = `Finish bookmarking ${draft.tabs.length} tabs`;
  })
  .catch(() => {});
$('bookmark-dismiss').addEventListener('click', async () => {
  if (!pendingBookmark) return;
  try {
    await chrome.storage.local.remove(draftKey(pendingBookmark.id));
    pendingBookmark = null;
    $('bookmark-resume-bar').hidden = true;
    input.focus();
  } catch (error) {
    notice(error.message);
  }
});
$('destination').addEventListener('change', () => {
  $('new-name-label').hidden = action === 'group' && Boolean($('destination').value);
});
$('action-cancel').addEventListener('click', closeAction);
$('action-confirm').addEventListener('click', async () => {
  if (busy || !action) return;
  busy = true;
  syncSelection();
  $('action-confirm').disabled = true;
  $('action-cancel').disabled = true;
  try {
    const kind = action;
    const result = await request(kind === 'group' ? 'group-tabs' : 'bookmark-tabs', {
      tabIds: actionIds,
      groupId:
        $('destination').value && kind === 'group' ? Number($('destination').value) : undefined,
      folderId: $('destination').value,
      title: $('new-name').value,
    });
    picked.clear();
    closeAction();
    notice(
      `${result.count} tabs ${kind === 'group' ? 'grouped.' : 'bookmarked.'}${result.skipped ? ` ${result.skipped} skipped.` : ''}${result.failed ? ` ${result.failed} could not be saved.` : ''}`,
    );
  } catch (error) {
    $('action-error').textContent = error.message;
  } finally {
    busy = false;
    $('action-confirm').disabled = false;
    $('action-cancel').disabled = false;
    await refresh();
  }
});
async function restoreBatch(id) {
  if (busy) return;
  busy = true;
  syncUndo();
  syncSelection();
  try {
    const result = await request('undo-close', { id });
    notice(
      `${result.count} ${result.count === 1 ? 'tab restored' : 'tabs restored'}.${result.failed ? ` ${result.failed} could not be reopened; retry with Restore.` : ''}${result.activationError ? ` ${result.activationError}` : ''}`,
    );
  } catch (error) {
    notice(error.message);
  } finally {
    busy = false;
    await refresh();
  }
}
async function open(index) {
  const item = results[index];
  if (!item || opening || busy) return;
  opening = true;
  try {
    await request(
      item.kind === 'tab' ? 'activate' : 'open-history',
      item.kind === 'tab' ? { tabId: item.tabId } : { url: item.url },
    );
    window.close();
  } catch (error) {
    notice(error.message);
    await refresh();
  } finally {
    opening = false;
  }
}
async function fetchHistory(query, version) {
  if (!query.trim()) return;
  try {
    const items = await request('history', { query });
    if (version !== searchVersion || !sources.history) return;
    history = items.map(prepare);
    render(false);
  } catch {
    if (version === searchVersion)
      notice('History could not be read. Tab search is still available.');
  }
}
async function updateSettings(patch) {
  releaseOrder();
  const old = { ...data.settings };
  data.settings = { ...old, ...patch };
  render();
  try {
    data.settings = await request('settings', { settings: patch });
    syncFilters();
  } catch (error) {
    data.settings = old;
    render();
    notice(error.message);
  }
}
async function refresh() {
  const version = ++refreshVersion;
  try {
    const snapshot = await request('snapshot');
    if (version !== refreshVersion) return;
    data = snapshot;
    tabs = data.tabs.map(prepare);
    applyTheme(data.settings.theme);
    setPreview(data.preview);
    render(false);
    if (location.search.includes('switcher') && !preview) window.close();
    const shortcut = data.commands.find((command) => command.name === '_execute_action')?.shortcut;
    $('search-shortcut').textContent = shortcut ? shortcutLabel(shortcut) : 'Set shortcut';
    if (!shortcut) notice('Search shortcut is unassigned. Open settings to choose one.');
    if (uiBuild && snapshot.version !== uiBuild)
      notice('Reload Tab Navigator in Chrome’s Extensions page to finish this update.');
  } catch (error) {
    notice(error.message);
  }
}
input.addEventListener('input', () => {
  picked.clear();
  releaseOrder();
  searchVersion++;
  history = [];
  clearTimeout(timer);
  render();
  if (data && sources.history && input.value.trim()) {
    const version = searchVersion,
      query = input.value;
    timer = setTimeout(() => fetchHistory(query, version), 110);
  }
});
input.addEventListener('keydown', (event) => {
  if (event.isComposing || preview || action) return;
  if (
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  ) {
    event.preventDefault();
    if (event.repeat || busy) return;
    const item = results[selected];
    if (item?.kind === 'tab') togglePicked(item.tabId);
    else if (item)
      notice('Only open tabs can be selected. Press Enter to open this history result.');
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    holdOrder();
    setSelected(selected + (event.key === 'ArrowDown' ? 1 : -1));
  } else if (event.key === 'Enter') {
    event.preventDefault();
    open(selected);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if (action) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      closeAction();
    }
    if (event.key === 'Tab') {
      const controls = [...$('action-panel').querySelectorAll('button,input,select')].filter(
        (el) => !el.disabled && el.offsetParent,
      );
      const next =
        (controls.indexOf(document.activeElement) + (event.shiftKey ? -1 : 1) + controls.length) %
        controls.length;
      event.preventDefault();
      controls[next]?.focus();
    }
    return;
  }
  if (preview) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishPreview(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      finishPreview(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      request('command', { name: event.key === 'ArrowDown' ? 'cycle-older' : 'cycle-newer' }).catch(
        (error) => notice(error.message),
      );
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closePalette();
  }
  if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
    event.preventDefault();
    open(Number(event.key) - 1);
  }
  // Optional navigation from inside the palette, independent of global assignments.
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    request('command', { name: event.key === 'ArrowLeft' ? 'cycle-older' : 'cycle-newer' }).catch(
      (error) => notice(error.message),
    );
  }
});
$('clear').addEventListener('click', () => {
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
});
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
for (const key of ['tabs', 'history'])
  $(`${key}-filter`).addEventListener('click', () => {
    if (!data) return;
    sources[key] = !sources[key];
    releaseOrder();
    render();
    if (sources.history && input.value.trim()) fetchHistory(input.value, ++searchVersion);
    input.focus();
  });
$('window-filter').addEventListener(
  'click',
  () => data && updateSettings({ currentWindow: !data.settings.currentWindow }),
);
$('domain-filter').addEventListener('click', async () => {
  groupByDomain = !groupByDomain;
  releaseOrder();
  render();
  input.focus();
  try {
    await chrome.storage.local.set({ groupByDomain });
  } catch (error) {
    notice(`Could not save domain grouping: ${error.message}`);
  }
});

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, 100);
}
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onActivated.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener(scheduleRefresh);
chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.windows.onCreated.addListener(syncWindowScope);
chrome.windows.onRemoved.addListener(syncWindowScope);
chrome.windows.onFocusChanged.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);
chrome.tabs.onDetached.addListener(scheduleRefresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.closedBatches)) scheduleRefresh();
  if (area === 'session' && changes.paletteFocus?.newValue) scheduleRefresh();
  if (area === 'session' && changes.preview) {
    if (!changes.preview.newValue && preview) {
      window.close();
      return;
    }
    setPreview(changes.preview.newValue);
    render(false);
  }
});
try {
  groupByDomain = (await chrome.storage.local.get('groupByDomain')).groupByDomain !== false;
} catch {}
await Promise.all([refresh(), syncWindowScope()]);
input.focus();
