// Chrome's recently-closed list is capped. Keep our own durable recovery journal
// BEFORE closing anything, so large batches and popup/worker exits remain undoable.
import { closeReviews } from './close-review.js';
import { checkTabInput } from './input-check.js';
import { loadBookmarkDraft, saveBookmarkDraft } from './bookmark-draft.js';
import { UNDO_DURATION, undoExpiry } from './undo-time.js';
export function bulkActions(api) {
  const reviews = closeReviews(api);
  const getJournal = async () =>
    ((await api.storage.local.get('closedBatches')).closedBatches || []).filter(
      (batch) => undoExpiry(batch) > Date.now(),
    );
  const save = (closedBatches) => api.storage.local.set({ closedBatches });
  const liveTabs = async (ids) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('Select at least one open tab.');
    const wanted = new Set(ids.filter(Number.isInteger));
    const tabs = (await api.tabs.query({})).filter(
      (tab) => wanted.has(tab.id) && !tab.incognito && !tab.url?.startsWith(api.runtime.getURL('')),
    );
    if (!tabs.length) throw new Error('Those tabs are no longer open.');
    return tabs;
  };
  async function undoInfo() {
    const batches = await getJournal();
    return batches
      .map((batch) => ({
        id: batch.id,
        at: batch.at,
        expiresAt: undoExpiry(batch),
        count: batch.tabs.filter((tab) => tab.status !== 'restored' && tab.status !== 'not-closed')
          .length,
      }))
      .filter((batch) => batch.count);
  }
  async function prepareClose(ids, keepers) {
    return reviews.prepare(await liveTabs(ids), keepers);
  }
  async function closeOne(id) {
    if (!Number.isInteger(id)) throw Error('Choose an open tab to close.');
    return closeSelected([id]);
  }
  async function closeSelected(ids) {
    return performClose(ids, null, true);
  }
  async function close(ids, approval) {
    return performClose(ids, approval, false);
  }
  async function performClose(ids, approval, explicit) {
    const selected = await liveTabs(ids);
    // A manual Close in search is the user's final instruction. Only the
    // suggested duplicate-cleanup flow uses the conservative review checks.
    const { eligible: tabs, rejected } = explicit
      ? { eligible: selected, rejected: [] }
      : await reviews.authorize(selected, approval);
    if (!tabs.length) return { count: 0, skipped: selected.length, protected: rejected };
    if (
      tabs.some(
        (tab) => !/^(https?:|file:|chrome:|about:blank)/.test(tab.pendingUrl || tab.url || ''),
      )
    ) {
      throw new Error(
        'Some selected tabs cannot be reopened safely. Deselect them before closing.',
      );
    }
    const [groups, [current]] = await Promise.all([
      api.tabGroups.query({}),
      api.tabs.query({ active: true, lastFocusedWindow: true }),
    ]);
    const batches = await getJournal();
    const batch = {
      id: crypto.randomUUID(),
      at: Date.now(),
      currentId: current?.id,
      tabs: tabs.map((tab) => ({
        originalId: tab.id,
        url: tab.pendingUrl || tab.url,
        title: tab.title,
        index: tab.index,
        windowId: tab.windowId,
        pinned: tab.pinned,
        status: 'pending',
        group: groups.find((group) => group.id === tab.groupId) || null,
      })),
    };
    batches.push(batch);
    await save(batches); // A full disk or storage quota must prevent the close.
    const all = await api.tabs.query({});
    const wanted = new Set(tabs.map((tab) => tab.id));
    const windowCounts = new Map();
    for (const tab of all)
      windowCounts.set(tab.windowId, (windowCounts.get(tab.windowId) || 0) + 1);
    let closed = 0;
    const deadline = Date.now() + 30000;
    const approvals = new Map(tabs.map((tab) => [tab.id, tab.closeApproval]));
    for (const row of batch.tabs) {
      try {
        if (Date.now() > deadline) {
          row.status = 'not-closed';
          rejected.push({
            tabId: row.originalId,
            reason: 'The batch reached its time limit. This tab stayed open.',
          });
          continue;
        }
        const current = await api.tabs.get(row.originalId).catch(() => null);
        if (!current || (current.pendingUrl || current.url) !== row.url) {
          row.status = 'not-closed';
          continue;
        }
        const approval = approvals.get(row.originalId);
        if (approval?.keeperIds) {
          const keepers = await Promise.all(
            approval.keeperIds.map((id) => api.tabs.get(id).catch(() => null)),
          );
          if (
            !keepers.some((tab) => tab?.url === row.url && !tab.pendingUrl && !wanted.has(tab.id))
          ) {
            row.status = 'not-closed';
            rejected.push({
              tabId: row.originalId,
              reason: 'The copy to keep is no longer available.',
            });
            continue;
          }
        }
        if (!explicit) {
          const check = await checkTabInput(api, current);
          if (
            check.status !== 'clear' &&
            !(approval.acknowledged && check.status === approval.status)
          ) {
            row.status = 'not-closed';
            rejected.push({ tabId: row.originalId, reason: check.reason });
            continue;
          }
        }
        const latest = await api.tabs.get(row.originalId).catch(() => null);
        if (!latest || (latest.pendingUrl || latest.url) !== row.url) {
          row.status = 'not-closed';
          continue;
        }
        if (windowCounts.get(row.windowId) <= 1) {
          await api.tabs.create({ windowId: row.windowId, active: false });
          windowCounts.set(row.windowId, 2);
        }
        await api.tabs.remove(row.originalId);
        windowCounts.set(row.windowId, windowCounts.get(row.windowId) - 1);
        row.status = 'closed';
        closed++;
      } catch {
        row.status = 'not-closed';
      }
    }
    batch.expiresAt = Date.now() + UNDO_DURATION;
    await save(batches);
    return { count: closed, skipped: selected.length - closed, protected: rejected };
  }
  async function undo(id) {
    const batches = await getJournal();
    const batch = batches.find((item) => item.id === id);
    if (!batch)
      throw new Error(
        'This close has already been undone or its one-minute restore time has ended.',
      );
    const windows = new Map(),
      groups = new Map();
    let restored = 0,
      failed = 0;
    let target;
    for (const row of [...batch.tabs].sort(
      (a, b) => a.windowId - b.windowId || a.index - b.index,
    )) {
      if (row.status === 'restored' || row.status === 'not-closed') continue;
      // Recover a worker interrupted between removal and journal finalization.
      if (row.status === 'pending') {
        const original = await api.tabs.get(row.originalId).catch(() => null);
        if (original && (original.pendingUrl || original.url) === row.url) {
          row.status = 'not-closed';
          await save(batches);
          continue;
        }
      }
      try {
        let windowId = windows.get(row.windowId) || row.windowId;
        const existingWindow = await api.windows.get(windowId).catch(() => null);
        if (!existingWindow) {
          const window = await api.windows.create({ focused: false });
          windowId = window.id;
          windows.set(row.windowId, windowId);
        }
        const tab = await api.tabs.create({
          windowId,
          url: row.url,
          index: row.index,
          active: false,
          pinned: Boolean(row.pinned),
        });
        row.status = 'restored';
        row.restoredId = tab.id;
        await save(batches); // Persist progress so retries never duplicate completed rows.
        restored++;
        if (!target || row.originalId === batch.currentId)
          target = { tabId: tab.id, windowId: tab.windowId };
        if (row.group && !row.pinned) {
          try {
            const key = `${windowId}:${row.group.id}`;
            let groupId = groups.get(key);
            const old = await api.tabGroups.get(row.group.id).catch(() => null);
            if (!Number.isInteger(groupId) && old?.windowId === windowId) groupId = old.id;
            groupId = await api.tabs.group(
              Number.isInteger(groupId) ? { tabIds: [tab.id], groupId } : { tabIds: [tab.id] },
            );
            groups.set(key, groupId);
            if (old?.windowId !== windowId)
              await api.tabGroups.update(groupId, {
                title: row.group.title,
                color: row.group.color,
                collapsed: row.group.collapsed,
              });
          } catch {
            /* The page is restored even if its original group cannot be. */
          }
        }
      } catch {
        failed++;
      }
    }
    if (failed) batch.expiresAt = Date.now() + UNDO_DURATION;
    await save(
      batches.filter((item) =>
        item.tabs.some((row) => !['restored', 'not-closed'].includes(row.status)),
      ),
    );
    return { count: restored, failed, ...target };
  }
  async function group(ids, groupId, title) {
    const tabs = await liveTabs(ids);
    if (tabs.some((tab) => tab.pinned))
      throw new Error('Pinned tabs cannot join a group. Deselect or unpin them first.');
    if (Number.isInteger(groupId)) {
      const target = await api.tabGroups.get(groupId);
      for (const tab of tabs)
        if (tab.windowId !== target.windowId)
          await api.tabs.move(tab.id, { windowId: target.windowId, index: -1 });
      await api.tabs.group({ groupId, tabIds: tabs.map((tab) => tab.id) });
    } else {
      const name = String(title || '')
        .trim()
        .slice(0, 100);
      if (!name) throw new Error('Give the new group a name.');
      for (const windowId of new Set(tabs.map((tab) => tab.windowId))) {
        const id = await api.tabs.group({
          tabIds: tabs.filter((tab) => tab.windowId === windowId).map((tab) => tab.id),
        });
        await api.tabGroups.update(id, { title: name, color: 'green' });
      }
    }
    return { count: tabs.length };
  }
  async function folders() {
    if (!(await api.permissions.contains({ permissions: ['bookmarks'] })))
      throw new Error('Allow bookmark access to choose a folder.');
    const result = [];
    const walk = (nodes, path = '') =>
      nodes.forEach((node) => {
        if (node.url || node.unmodifiable) return;
        const label = [path, node.title].filter(Boolean).join(' / ');
        if (node.id !== '0') result.push({ id: node.id, title: label || 'Bookmarks' });
        walk(node.children || [], label);
      });
    walk(await api.bookmarks.getTree());
    return result;
  }
  async function bookmark(ids, folderId, title) {
    const tabs = await liveTabs(ids);
    const allowed = await folders();
    if (!allowed.some((folder) => folder.id === folderId))
      throw new Error('Choose an available bookmark folder.');
    let parentId = folderId;
    if (String(title || '').trim())
      parentId = (await api.bookmarks.create({ parentId, title: title.trim().slice(0, 100) })).id;
    const existing = new Set((await api.bookmarks.getChildren(parentId)).map((item) => item.url));
    let count = 0,
      skipped = 0,
      failed = 0;
    for (const tab of tabs) {
      const url = tab.pendingUrl || tab.url;
      if (existing.has(url)) {
        skipped++;
        continue;
      }
      try {
        await api.bookmarks.create({ parentId, title: tab.title || url, url });
        existing.add(url);
        count++;
      } catch {
        failed++;
      }
    }
    return { count, skipped, failed };
  }
  async function bookmarkDraft(id) {
    const draft = await loadBookmarkDraft(api, id);
    if (!draft) throw Error('This saved selection was not found.');
    if (draft.state === 'complete') return draft.result;
    const available = await folders();
    if (!available.some((folder) => folder.id === (draft.createdFolderId || draft.folderId)))
      throw Error('Choose an available bookmark folder.');
    let parentId = draft.createdFolderId || draft.folderId;
    if (!draft.createdFolderId && String(draft.title || '').trim()) {
      const folder = await api.bookmarks.create({
        parentId,
        title: draft.title.trim().slice(0, 100),
      });
      parentId = folder.id;
      draft.createdFolderId = parentId;
      await saveBookmarkDraft(api, draft);
    }
    const existing = new Set((await api.bookmarks.getChildren(parentId)).map((item) => item.url));
    let count = 0,
      skipped = 0,
      failed = 0;
    const remaining = [];
    for (const tab of draft.tabs) {
      if (existing.has(tab.url)) {
        skipped++;
        continue;
      }
      try {
        await api.bookmarks.create({ parentId, title: tab.title || tab.url, url: tab.url });
        existing.add(tab.url);
        count++;
      } catch {
        failed++;
        remaining.push(tab);
      }
    }
    const result = { count, skipped, failed };
    draft.result = result;
    draft.state = failed ? 'pending' : 'complete';
    draft.tabs = remaining;
    await saveBookmarkDraft(api, draft);
    return result;
  }
  return {
    prepareClose,
    closeOne,
    closeSelected,
    close,
    undo,
    undoInfo,
    group,
    folders,
    bookmark,
    bookmarkDraft,
  };
}
