export function reconcile(saved = {}, tabs, now = Date.now()) {
  const live = new Set(tabs.map((tab) => tab.id));
  const order = [...new Set((saved.order || []).filter((id) => live.has(id)))];
  const remembered = new Set(order);
  const missing = tabs.filter((tab) => !remembered.has(tab.id));
  order.push(...missing.map((tab) => tab.id));
  const seen = {},
    created = {};
  const timestamp = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
  for (const tab of tabs) {
    // Chrome can know about an activation missed during a reload. Conversely,
    // our window-focus/navigation observation can be newer than lastAccessed.
    seen[tab.id] = Math.max(timestamp(saved.seen?.[tab.id]), timestamp(tab.lastAccessed));
    // Chrome does not expose creation time for tabs opened before installation.
    created[tab.id] = saved.created?.[tab.id] || 0;
  }
  // Sort the underlying MRU list using the same times as the visible rows.
  // Stable sorting preserves recorded order on ties; an open preview has its
  // own frozen list and is not reordered by this reconciliation.
  order.sort((a, b) => seen[b] - seen[a]);
  const cycle =
    saved.cycle && now - saved.cycle.at < 1800
      ? { ...saved.cycle, ids: saved.cycle.ids.filter((id) => live.has(id)) }
      : null;
  return { order, seen, created, cycle: cycle?.ids.length > 1 ? cycle : null };
}

export function touch(state, id, now = Date.now(), preserveCycle = false) {
  state.order = [id, ...state.order.filter((other) => other !== id)];
  state.seen[id] = now;
  if (!preserveCycle) state.cycle = null;
}

export function removeTab(state, id) {
  state.order = state.order.filter((other) => other !== id);
  delete state.seen[id];
  delete state.created[id];
  // Restart a cycle when its membership changes, avoiding stale indices.
  state.cycle = null;
}

export function cycleTarget(state, currentId, direction, eligibleIds, now = Date.now()) {
  const eligible = new Set(eligibleIds);
  let cycle = state.cycle;
  if (
    !cycle ||
    now - cycle.at >= 1800 ||
    cycle.ids[cycle.index] !== currentId ||
    cycle.ids.some((id) => !eligible.has(id))
  ) {
    const ids = [currentId, ...state.order.filter((id) => id !== currentId && eligible.has(id))];
    cycle = { ids, index: 0, at: now };
  }
  if (cycle.ids.length < 2) return null;
  cycle.index = (cycle.index + direction + cycle.ids.length) % cycle.ids.length;
  cycle.at = now;
  state.cycle = cycle;
  return cycle.ids[cycle.index];
}
