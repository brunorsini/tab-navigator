import { checkTabsInput } from './input-check.js';
const KEY = 'closeReviews';
const MAX_AGE = 10 * 60 * 1000;

export function closeReviews(api) {
  const load = async () => (await api.storage.session.get(KEY))[KEY] || {};
  const save = (reviews) => api.storage.session.set({ [KEY]: reviews });
  async function prepare(tabs, keepers = []) {
    const rows = await checkTabsInput(api, tabs);
    const token = crypto.randomUUID(),
      at = Date.now();
    const reviews = Object.fromEntries(
      Object.entries(await load())
        .filter(([, item]) => at - item.at < MAX_AGE)
        .slice(-5),
    );
    const keep = Array.isArray(keepers)
      ? keepers
          .filter((row) => typeof row.url === 'string' && Array.isArray(row.ids))
          .map((row) => ({ url: row.url, ids: row.ids.filter(Number.isInteger) }))
      : [];
    reviews[token] = {
      at,
      keepers: keep,
      rows: rows.map((tab) => ({
        id: tab.id,
        url: tab.pendingUrl || tab.url,
        status: tab.check.status,
      })),
    };
    await save(reviews);
    return {
      token,
      rows: rows.map((tab) => ({
        tabId: tab.id,
        title: tab.title || tab.url,
        url: tab.pendingUrl || tab.url,
        windowId: tab.windowId,
        pinned: tab.pinned,
        audible: tab.audible,
        lastAccessed: tab.lastAccessed,
        check: tab.check,
      })),
    };
  }
  async function authorize(tabs, { token, acknowledged = [] } = {}) {
    const reviews = await load(),
      review = reviews[token];
    if (!review || Date.now() - review.at > MAX_AGE)
      throw Error('Review these tabs again before closing. Nothing was closed.');
    const approved = new Set(
      Array.isArray(acknowledged) ? acknowledged.filter(Number.isInteger) : [],
    );
    const reviewed = new Map(review.rows.map((row) => [row.id, row]));
    const requested = new Set(tabs.map((tab) => tab.id));
    const all = await api.tabs.query({});
    const safeKeepers = new Set(
      review.keepers
        .filter((group) =>
          group.ids.some(
            (id) =>
              !requested.has(id) &&
              all.some((tab) => tab.id === id && tab.url === group.url && !tab.pendingUrl),
          ),
        )
        .map((group) => group.url),
    );
    const rejected = [],
      candidates = [];
    for (const tab of tabs) {
      const old = reviewed.get(tab.id);
      if (!old || old.url !== (tab.pendingUrl || tab.url)) {
        rejected.push({ tabId: tab.id, reason: 'The tab changed since review.' });
        continue;
      }
      if (review.keepers.some((group) => group.url === old.url) && !safeKeepers.has(old.url)) {
        rejected.push({
          tabId: tab.id,
          reason: 'The copy you chose to keep is no longer available.',
        });
        continue;
      }
      candidates.push({
        ...tab,
        closeApproval: {
          status: old.status,
          acknowledged: approved.has(tab.id),
          keeperIds: review.keepers.find((group) => group.url === old.url)?.ids,
        },
      });
    }
    delete reviews[token];
    await save(reviews); // A review is single-use.
    return { eligible: candidates, rejected };
  }
  return { prepare, authorize };
}
