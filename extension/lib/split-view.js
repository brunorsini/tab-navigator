export function splitAvailability(tabs, supported) {
  if (!supported) return 'Native split view needs Chrome 155 or newer.';
  if (tabs.length !== 2) return 'Select exactly 2 tabs for split view.';
  if (tabs.some((tab) => Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0))
    return 'Separate the existing split view first.';
  if (tabs[0].windowId !== tabs[1].windowId) return 'Choose 2 tabs in the same window.';
  if (Boolean(tabs[0].pinned) !== Boolean(tabs[1].pinned))
    return 'Choose 2 pinned tabs or 2 unpinned tabs.';
  if ((tabs[0].groupId ?? -1) !== (tabs[1].groupId ?? -1))
    return 'Choose 2 tabs in the same group, or 2 ungrouped tabs.';
  return '';
}

export async function openSplitView(api, ids) {
  if (
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    ids.some((id) => !Number.isInteger(id)) ||
    ids[0] === ids[1]
  ) {
    throw Error('Select exactly 2 different tabs for split view.');
  }
  const tabs = await Promise.all(ids.map((id) => api.tabs.get(id)));
  if (tabs.some((tab) => tab.incognito || tab.url?.startsWith(api.runtime.getURL(''))))
    throw Error('Choose 2 regular browser tabs.');
  const reason = splitAvailability(tabs, typeof api.tabs.createSplit === 'function');
  if (reason) throw Error(reason);
  const [left, right] = [...tabs].sort((a, b) => a.index - b.index);
  let moved = false;
  try {
    // Native Chrome requires adjacency, in the same window/group/pin state.
    if (right.index !== left.index + 1) {
      await api.tabs.move(right.id, { index: left.index + 1 });
      moved = true;
    }
    const live = await Promise.all([left.id, right.id].map((id) => api.tabs.get(id)));
    const changed = splitAvailability(live, true);
    if (changed) throw Error(changed);
    if (live[1].index !== live[0].index + 1)
      throw Error('The tab positions changed. Try split view again.');
    const splitViewId = await api.tabs.createSplit([left.id, right.id]);
    // The split already exists: a focus failure must not trigger an order rollback.
    try {
      await api.tabs.update(left.id, { active: true });
      await api.windows.update(left.windowId, { focused: true });
    } catch {}
    return { splitViewId, count: 2 };
  } catch (error) {
    if (moved) {
      const current = await api.tabs.get(right.id).catch(() => null);
      if (
        current?.windowId === right.windowId &&
        current.index === left.index + 1 &&
        (current.groupId ?? -1) === (right.groupId ?? -1) &&
        !(current.splitViewId >= 0)
      ) {
        try {
          await api.tabs.move(right.id, { index: right.index });
        } catch {}
      }
    }
    throw error;
  }
}
