// One age scale for search, the recent-tab switcher, and duplicate review.
// Derive it only when rendering; no timers or background polling are needed.
export function recency(time, { now = Date.now(), current = false } = {}) {
  if (current) return { label: 'Current', tone: 'recent', title: 'You are using this tab now.' };
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(new Date(time).getTime())) {
    return { label: 'Unknown', tone: 'unknown', title: 'Last use is unavailable for this page.' };
  }
  const elapsed = Math.max(0, now - time),
    minutes = Math.floor(elapsed / 60000);
  const tone = elapsed < 3600000 ? 'recent' : elapsed < 86400000 ? 'today' : 'older';
  const label =
    minutes < 1
      ? 'just now'
      : minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.floor(minutes / 60)}h ago`
          : `${Math.floor(minutes / 1440)}d ago`;
  const range = {
    recent: 'Less than 1 hour ago',
    today: '1 hour to 24 hours ago',
    older: '24 hours ago or more',
  }[tone];
  return {
    label,
    tone,
    title: `Last used: ${new Date(time).toLocaleString()} · ${range}`,
    dateTime: new Date(time).toISOString(),
  };
}
