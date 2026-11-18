import { request, applyTheme } from './lib/client.js';
import {
  duplicateGroups,
  refreshDuplicateGroups,
  defaultClosures,
  canCloseCopy,
  keeperPlan,
} from './lib/duplicates.js';
import { normalize } from './lib/search.js';
import { recency } from './lib/recency.js';
import { createUndoBars } from './lib/undo-bars.js';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text != null) item.textContent = text;
  return item;
};
const params = new URLSearchParams(location.search),
  selectionToken = params.get('selection');
const sourceId = Number(params.get('from'));
let data,
  groups = [],
  closing = new Set(),
  mode = 'duplicates',
  report = null,
  reviewed = new Set(),
  selectedIds = [],
  reviewKeepers = [];
let limit = 20,
  busy = false,
  metadataVersion = 0;
const undoBars = createUndoBars($('undo-bars'), { document, restore: restoreBatch });
const expanded = new Set(),
  checks = new Map();
const labels = {
  clear: 'No edits detected',
  possible: 'Possible unsaved input',
  unknown: 'Not checked',
};
const message = (text, error = false) => {
  $('review-notice').textContent = text;
  $('review-notice').hidden = !text;
  $('review-notice').classList.toggle('error', error);
};
function favicon(url) {
  const icon = el('span', 'site-icon', new URL(url).hostname[0].toUpperCase());
  icon.setAttribute('aria-hidden', 'true');
  const image = el('img', 'favicon');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  const src = new URL(chrome.runtime.getURL('/_favicon/'));
  src.searchParams.set('pageUrl', url);
  src.searchParams.set('size', '32');
  image.addEventListener('load', () => {
    icon.firstChild.textContent = '';
    image.classList.add('loaded');
    icon.classList.add('has-favicon');
  });
  image.addEventListener('error', () => image.remove());
  image.src = src.href;
  icon.append(image);
  return icon;
}
function visibleGroups() {
  const q = normalize($('filter').value);
  return groups.filter(
    (group) =>
      !q || normalize(group.url + ' ' + group.copies.map((tab) => tab.title).join(' ')).includes(q),
  );
}
function visibleClosures() {
  return visibleGroups().flatMap((group) =>
    group.copies.filter((tab) => closing.has(tab.tabId)).map((tab) => tab.tabId),
  );
}
function syncSummary() {
  const isReview = mode === 'review',
    visible = visibleGroups();
  const copies = isReview
    ? report.rows.length
    : visible.reduce((n, group) => n + group.copies.length, 0);
  const count = isReview ? reviewed.size : visibleClosures().length;
  const possible = isReview
    ? report.rows.filter((tab) => reviewed.has(tab.tabId) && tab.check.status === 'possible').length
    : 0;
  const unknown = isReview
    ? report.rows.filter((tab) => reviewed.has(tab.tabId) && tab.check.status === 'unknown').length
    : 0;
  $('stat-one').textContent = (isReview ? copies - count : visible.length).toLocaleString();
  $('stat-one-label').textContent = isReview ? 'staying open' : 'repeated pages';
  $('stat-two').textContent = copies.toLocaleString();
  $('stat-two-label').textContent = isReview ? 'tabs reviewed' : 'open copies';
  $('stat-three').textContent = count.toLocaleString();
  $('stat-three-label').textContent = 'marked to close';
  $('plan-summary').textContent = isReview
    ? `${count} to close · ${copies - count} staying open`
    : `${copies - count} to keep · ${count} to review`;
  $('plan-detail').textContent = isReview
    ? possible || unknown
      ? `${possible ? `${possible} with possible unsaved input. ` : ''}${unknown ? `${unknown} not checked. ` : ''}Undo restores addresses, not unsaved work.`
      : 'Undo restores addresses, not unsaved work. We check again before closing.'
    : 'Nothing closes until you review and confirm. Changes apply to the groups shown.';
  $('plan-detail').classList.toggle('risk', Boolean(possible || unknown));
  $('primary').textContent = busy
    ? 'Working…'
    : isReview && report.token
      ? `Close ${count} tabs`
      : `Review ${count} closures →`;
  $('primary').disabled = busy || !count || !data?.closeReviewVersion;
  undoBars.set(data?.undo, { disabled: busy });
  for (const node of document.querySelectorAll(
    '.copy-controls button,.review-tools button,.review-tools input,.card-more',
  ))
    node.disabled = busy;
  for (const button of document.querySelectorAll('.group-close'))
    button.disabled = busy || !Number(button.dataset.count) || !data?.closeReviewVersion;
}
function choose(tab, value, group) {
  if (busy) return;
  const set = mode === 'review' ? reviewed : closing;
  if (value && group && !canCloseCopy(group, tab.tabId, closing)) {
    message('Keep at least one copy of each address.');
    return;
  }
  if (value) set.add(tab.tabId);
  else set.delete(tab.tabId);
  if (mode === 'review') {
    const unknown = report.rows.filter((row) => row.check.status === 'unknown');
    $('include-unchecked').checked =
      Boolean(unknown.length) && unknown.every((row) => reviewed.has(row.tabId));
  }
  renderCards();
  syncSummary();
}
function copyRow(tab, group, mostRecentId) {
  const isReview = mode === 'review',
    set = isReview ? reviewed : closing,
    close = set.has(tab.tabId);
  const row = el('div', 'copy-row');
  row.dataset.choice = close ? 'close' : 'keep';
  row.dataset.tab = tab.tabId;
  row.append(el('span', 'choice-label', close ? '− CLOSE' : '✓ KEEP'));
  const copy = el('div'),
    title = el('div', 'copy-title', tab.title || tab.url),
    meta = el('div', 'copy-meta');
  const when = recency(tab.lastAccessed),
    time = el(
      'time',
      `recency recency--${when.tone}`,
      when.tone === 'unknown' ? 'Last use unknown' : `Used ${when.label}`,
    );
  time.title = when.title;
  if (when.dateTime) time.setAttribute('datetime', when.dateTime);
  meta.append(el('span', '', `Window ${windowNumber(tab.windowId)}`), el('span', '', '·'), time);
  if (!isReview && tab.tabId === mostRecentId)
    meta.append(el('span', 'tag recommended', 'Most recent in this group'));
  if (tab.group) meta.append(el('span', 'tag', tab.group));
  if (tab.pinned) meta.append(el('span', 'tag', 'Pinned'));
  if (tab.audible) meta.append(el('span', 'tag', 'Playing audio'));
  if (tab.active || tab.tabId === sourceId) meta.append(el('span', 'tag', 'Active tab'));
  const check = isReview
    ? tab.check
    : checks.get(tab.tabId)?.url === tab.url
      ? checks.get(tab.tabId).check
      : null;
  if (check) meta.append(el('span', `tag ${check.status}`, labels[check.status]));
  copy.append(title, meta);
  if (isReview) {
    copy.append(el('div', 'duplicate-address', tab.url), el('p', 'copy-reason', check.reason));
  }
  row.append(copy);
  const controls = el('div', 'copy-controls'),
    visit = el('button', 'visit-copy', 'Visit ↗');
  visit.setAttribute('aria-label', `Visit ${tab.title || tab.url}`);
  visit.addEventListener('click', () =>
    request('activate', { tabId: tab.tabId }).catch((error) => message(error.message, true)),
  );
  const toggle = el('div', 'choice-switch');
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', `Action for ${tab.title || tab.url}`);
  for (const [text, value] of [
    ['Keep', false],
    ['Close', true],
  ]) {
    const button = el('button', value ? 'close-choice' : '', text);
    button.dataset.tab = tab.tabId;
    button.dataset.choice = value ? 'close' : 'keep';
    button.setAttribute('aria-pressed', String(close === value));
    button.setAttribute('aria-label', `${text} ${tab.title || tab.url}`);
    button.addEventListener('click', () => choose(tab, value, group));
    toggle.append(button);
  }
  controls.append(visit, toggle);
  row.append(controls);
  return row;
}
function windowNumber(id) {
  return [...new Set((data?.tabs || []).map((tab) => tab.windowId))].indexOf(id) + 1 || '?';
}
function renderCards() {
  const focus = document.activeElement?.dataset;
  const focusKey = focus?.tab ? { tab: focus.tab, choice: focus.choice } : null;
  const fragment = document.createDocumentFragment();
  let total;
  if (mode === 'review') {
    total = report.rows.length;
    const card = el('section', 'duplicate-card');
    for (const tab of report.rows.slice(0, limit)) card.append(copyRow(tab));
    fragment.append(card);
  } else {
    const visible = visibleGroups();
    total = visible.length;
    for (const group of visible.slice(0, limit)) {
      const card = el('section', 'duplicate-card'),
        heading = el('div', 'duplicate-heading'),
        copy = el('div', 'duplicate-heading-copy');
      copy.append(el('h2', '', group.copies[0].title), el('div', 'duplicate-address', group.url));
      const ids = group.copies.filter((tab) => closing.has(tab.tabId)).map((tab) => tab.tabId);
      const actions = el('div', 'duplicate-actions'),
        closeGroup = el('button', 'primary-button group-close', `Close ${ids.length}…`);
      closeGroup.dataset.count = ids.length;
      closeGroup.disabled = busy || !ids.length || !data?.closeReviewVersion;
      closeGroup.title = 'Review these copies before closing. Copies marked Keep stay open.';
      closeGroup.setAttribute(
        'aria-label',
        `Close ${ids.length} ${ids.length === 1 ? 'copy' : 'copies'} of ${group.copies[0].title || group.url} — review first`,
      );
      closeGroup.addEventListener('click', () =>
        prepareReview(ids, keeperPlan([group], new Set(ids))),
      );
      actions.append(el('span', 'duplicate-counter', `${group.copies.length} copies`), closeGroup);
      heading.append(favicon(group.url), copy, actions);
      card.append(heading);
      const shown = expanded.has(group.url) ? group.copies : group.copies.slice(0, 5);
      const mostRecent = group.copies.reduce((latest, tab) =>
        (tab.lastAccessed || 0) > (latest.lastAccessed || 0) ? tab : latest,
      );
      shown.forEach((tab) => card.append(copyRow(tab, group, mostRecent.tabId)));
      if (group.copies.length > 5) {
        const more = el(
          'button',
          'card-more',
          expanded.has(group.url) ? 'Show fewer copies' : `Show all ${group.copies.length} copies`,
        );
        more.addEventListener('click', () => {
          if (expanded.has(group.url)) expanded.delete(group.url);
          else expanded.add(group.url);
          renderCards();
        });
        card.append(more);
      }
      fragment.append(card);
    }
  }
  $('cards').replaceChildren(fragment);
  $('show-more').hidden = total <= limit;
  $('show-more').textContent = `Show ${Math.min(20, total - limit)} more`;
  $('empty-review').hidden = total > 0;
  if (focusKey)
    document
      .querySelector(`button[data-tab="${Number(focusKey.tab)}"][data-choice="${focusKey.choice}"]`)
      ?.focus({ preventScroll: true });
}
function showMode() {
  const review = mode === 'review';
  $('eyebrow').textContent = review ? 'TAB CLEANUP / FINAL REVIEW' : 'TAB CLEANUP / DUPLICATES';
  $('heading').textContent = review ? 'A last look before closing.' : 'Choose what stays.';
  $('intro').textContent = review
    ? 'Possible unsaved input and unchecked pages stay open by default. Every copy below has an explicit Keep or Close choice.'
    : 'Repeated addresses, side by side. Keep the copies you want, then review the rest before closing.';
  $('duplicates-tools').hidden = review;
  $('review-tools').hidden = !review;
  $('back').hidden = Boolean(selectionToken);
  $('explanation').textContent = review
    ? 'A quick check can spot changed form fields and editable documents, but cannot guarantee that an app has saved its work. No typed text is collected. Sleeping pages stay asleep.'
    : 'Same full address, including everything after ? and #. The newest copy, pinned tabs, active tabs, and audio stay open by default. Matching addresses can still contain different drafts.';
  $('empty-heading').textContent =
    selectionToken && review
      ? 'No tabs left to review.'
      : $('filter').value
        ? 'No matching duplicate groups.'
        : 'No repeated addresses.';
  $('empty-copy').textContent =
    selectionToken && review
      ? 'Any completed close can be undone below.'
      : $('filter').value
        ? 'Try another title or website.'
        : "Each open page has its own address. You're all set.";
  if (review) {
    const unknown = report.rows.filter((tab) => tab.check.status === 'unknown');
    $('unchecked-label').hidden = !unknown.length;
    $('include-unchecked').checked =
      Boolean(unknown.length) && unknown.every((tab) => reviewed.has(tab.tabId));
    $('check-permission').hidden = !unknown.some((tab) =>
      tab.check.reason.includes('access has not been granted'),
    );
  }
  renderCards();
  syncSummary();
}
async function loadSnapshot() {
  data = await request('snapshot');
  applyTheme(data.settings.theme);
  const scoped = data.tabs.filter(
    (tab) => !data.settings.currentWindow || tab.windowId === data.windowId,
  );
  groups = duplicateGroups(scoped);
  if (!data.closeReviewVersion)
    message(
      'The new close checks need one extension reload. In Chrome’s Extensions page, reload Tab Navigator, then reopen this view. Nothing can close here until the checks are running.',
      true,
    );
}
async function refreshMetadata() {
  if (!data || busy || document.hidden) return;
  const version = ++metadataVersion,
    previousData = data,
    previousReport = report;
  try {
    const fresh = await request('snapshot');
    if (version !== metadataVersion || busy || data !== previousData || report !== previousReport)
      return;
    data = fresh;
    groups = refreshDuplicateGroups(
      groups,
      fresh.tabs.filter((tab) => !fresh.settings.currentWindow || tab.windowId === fresh.windowId),
    );
    const eligible = new Set(groups.flatMap((group) => group.copies.map((tab) => tab.tabId)));
    for (const id of closing) if (!eligible.has(id)) closing.delete(id);
    if (report) {
      const live = new Map(fresh.tabs.map((tab) => [tab.tabId, tab]));
      report.rows = report.rows
        .filter((tab) => live.get(tab.tabId)?.url === tab.url)
        .map((tab) => ({ ...tab, ...live.get(tab.tabId), check: tab.check }));
      const remaining = new Set(report.rows.map((tab) => tab.tabId));
      for (const id of reviewed) if (!remaining.has(id)) reviewed.delete(id);
    }
    renderCards();
    syncSummary();
  } catch (error) {
    message(error.message, true);
  }
}
// Returning from Visit updates ages without polling or resetting user choices.
window.addEventListener('focus', refreshMetadata);
async function prepareReview(ids, keepers = []) {
  if (busy || !ids.length) return;
  busy = true;
  $('working').hidden = false;
  $('cards').hidden = true;
  syncSummary();
  selectedIds = ids;
  reviewKeepers = keepers;
  try {
    report = await request('prepare-close', { tabIds: ids, keepers });
    for (const tab of report.rows) checks.set(tab.tabId, { url: tab.url, check: tab.check });
    reviewed = new Set(
      report.rows.filter((tab) => tab.check.status === 'clear').map((tab) => tab.tabId),
    );
    mode = 'review';
    limit = 20;
    window.scrollTo(0, 0);
    message(
      report.rows.some((tab) => tab.check.status !== 'clear')
        ? 'Tabs that need your attention are marked KEEP. You can visit them to save your work, leave them open, or explicitly choose Close.'
        : 'Checks finished. Review the list below before confirming.',
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    $('working').hidden = true;
    $('cards').hidden = false;
    showMode();
  }
}
$('filter').addEventListener('input', () => {
  limit = 20;
  showMode();
});
$('show-more').addEventListener('click', () => {
  limit += 20;
  renderCards();
});
$('keep-all').addEventListener('click', () => {
  for (const group of visibleGroups()) for (const tab of group.copies) closing.delete(tab.tabId);
  showMode();
});
$('use-suggestions').addEventListener('click', () => {
  const visible = visibleGroups(),
    suggested = defaultClosures(visible, sourceId);
  for (const group of visible)
    for (const tab of group.copies) {
      if (suggested.has(tab.tabId)) closing.add(tab.tabId);
      else closing.delete(tab.tabId);
    }
  showMode();
});
$('back').addEventListener('click', () => {
  mode = 'duplicates';
  limit = 20;
  message('');
  showMode();
});
$('include-unchecked').addEventListener('change', (event) => {
  for (const tab of report.rows)
    if (tab.check.status === 'unknown') {
      if (event.target.checked) reviewed.add(tab.tabId);
      else reviewed.delete(tab.tabId);
    }
  showMode();
});
$('check-permission').addEventListener('click', async () => {
  const origins = [
    ...new Set(
      report.rows
        .filter((tab) => /^https?:/.test(tab.url))
        .map((tab) => `${new URL(tab.url).origin}/*`),
    ),
  ];
  try {
    if (!origins.length || !(await chrome.permissions.request({ origins }))) {
      message('Website access was not granted. Unchecked tabs still stay open by default.');
      return;
    }
    await prepareReview(selectedIds, reviewKeepers);
  } catch (error) {
    message(error.message, true);
  }
});
$('primary').addEventListener('click', async () => {
  if (busy) return;
  if (mode !== 'review') {
    const ids = visibleClosures();
    await prepareReview(ids, keeperPlan(visibleGroups(), new Set(ids)));
    return;
  }
  if (!report.token) {
    await prepareReview([...reviewed], reviewKeepers);
    return;
  }
  const ids = [...reviewed];
  if (!ids.length) return;
  busy = true;
  syncSummary();
  try {
    const result = await request('close-tabs', {
      tabIds: ids,
      token: report.token,
      acknowledged: report.rows
        .filter((tab) => reviewed.has(tab.tabId) && tab.check.status !== 'clear')
        .map((tab) => tab.tabId),
    });
    await loadSnapshot();
    const live = new Set(data.tabs.map((tab) => tab.tabId));
    report.rows = report.rows.filter((tab) => live.has(tab.tabId));
    reviewed.clear();
    if (!selectionToken) {
      mode = 'duplicates';
      closing = defaultClosures(groups, sourceId);
    } else {
      report.token = null;
    }
    message(
      `${result.count} tabs closed.${result.skipped ? ` ${result.skipped} stayed open because their state changed or they need attention.` : ''} ${result.count ? 'Restore is available for one minute below or in search.' : 'Nothing was removed.'}`,
    );
  } catch (error) {
    report.token = null;
    message(error.message, true);
  } finally {
    busy = false;
    showMode();
  }
});
async function restoreBatch(id) {
  if (busy) return;
  busy = true;
  syncSummary();
  try {
    const result = await request('undo-close', { id });
    await loadSnapshot();
    mode = 'duplicates';
    closing = defaultClosures(groups, sourceId);
    message(
      `${result.count} tabs reopened.${result.failed ? ` ${result.failed} could not reopen; Undo remains available.` : ''}${result.activationError ? ` ${result.activationError}` : ''}`,
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    showMode();
  }
}
try {
  await loadSnapshot();
  closing = defaultClosures(groups, sourceId);
  showMode();
  if (selectionToken) {
    const key = `review-request:${selectionToken}`,
      saved = (await chrome.storage.session.get(key))[key];
    if (!saved || Date.now() - saved.at > 600000)
      message('This selection expired. Reopen search and select the tabs again.', true);
    else if (data.closeReviewVersion) await prepareReview(saved.ids);
  }
} catch (error) {
  message(error.message, true);
}
