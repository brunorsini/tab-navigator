// A held-key cycle never changes recency or activates a tab until commit.
export function stepPreview(previous, order, currentId, eligible, direction, now = Date.now()) {
  if (
    !Array.isArray(previous?.ids) ||
    !previous.ids.every(Number.isInteger) ||
    !Number.isInteger(previous.index) ||
    previous.index < 0 ||
    previous.index >= previous.ids.length ||
    typeof previous.token !== 'string' ||
    !previous.token
  )
    previous = null;
  const live = new Set(eligible);
  let ids = previous?.ids.filter((id) => live.has(id));
  let index = ids?.indexOf(previous.ids[previous.index]);
  if (!ids?.length || index < 0) {
    ids = [currentId, ...order.filter((id) => id !== currentId && live.has(id))].filter((id) =>
      live.has(id),
    );
    index = 0;
  }
  if (ids.length < 2) return null;
  return {
    token: previous?.token || crypto.randomUUID(),
    ids,
    index: (index + direction + ids.length) % ids.length,
    originId: previous?.originId ?? currentId,
    at: now,
  };
}
