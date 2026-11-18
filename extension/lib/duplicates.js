export function duplicateGroups(tabs) {
  const byUrl = new Map();
  for (const tab of tabs) {
    // Deliberately preserve the complete address, including queries and fragments.
    if (!/^https?:\/\//.test(tab.url || '') || (tab.pendingUrl && tab.pendingUrl !== tab.url))
      continue;
    if (!byUrl.has(tab.url)) byUrl.set(tab.url, []);
    byUrl.get(tab.url).push(tab);
  }
  return [...byUrl]
    .filter(([, copies]) => copies.length > 1)
    .map(([url, copies]) => ({
      url,
      copies: copies.sort(
        (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.tabId - b.tabId,
      ),
    }))
    .sort(
      (a, b) =>
        b.copies.length - a.copies.length ||
        (b.copies[0].lastAccessed || 0) - (a.copies[0].lastAccessed || 0) ||
        a.url.localeCompare(b.url),
    );
}

// Refresh page metadata without moving rows under a user's Keep/Close choices.
// Closed/navigated copies leave their old group; newly discovered copies append.
export function refreshDuplicateGroups(previous, tabs) {
  const pending = new Map(duplicateGroups(tabs).map((group) => [group.url, group]));
  const result = [];
  for (const old of previous) {
    const fresh = pending.get(old.url);
    if (!fresh) continue;
    pending.delete(old.url);
    const copies = new Map(fresh.copies.map((tab) => [tab.tabId, tab]));
    const ordered = [];
    for (const tab of old.copies) {
      if (copies.has(tab.tabId)) {
        ordered.push(copies.get(tab.tabId));
        copies.delete(tab.tabId);
      }
    }
    result.push({ ...fresh, copies: [...ordered, ...copies.values()] });
  }
  return [...result, ...pending.values()];
}

export function defaultClosures(groups, currentId) {
  return new Set(
    groups.flatMap((group) => {
      const newest = group.copies.reduce((latest, tab) =>
        (tab.lastAccessed || 0) > (latest.lastAccessed || 0) ? tab : latest,
      );
      return group.copies
        .filter(
          (tab) =>
            tab.tabId !== newest.tabId &&
            !tab.pinned &&
            !tab.audible &&
            !tab.active &&
            tab.tabId !== currentId,
        )
        .map((tab) => tab.tabId);
    }),
  );
}

export function canCloseCopy(group, id, closing) {
  return group.copies.some((tab) => tab.tabId !== id && !closing.has(tab.tabId));
}

export function keeperPlan(groups, closing) {
  return groups
    .filter((group) => group.copies.some((tab) => closing.has(tab.tabId)))
    .map((group) => ({
      url: group.url,
      ids: group.copies.filter((tab) => !closing.has(tab.tabId)).map((tab) => tab.tabId),
    }));
}
