import { getDomain } from '../vendor/tldts.js';
import { normalize, wholePhrase } from './search.js';

export const ROW_HEIGHT = 62;
export const HEADING_HEIGHT = 26;

export function domainOf(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return 'Local files';
    if (!/^https?:$/.test(url.protocol))
      return url.protocol === 'chrome:' ? 'Chrome' : url.protocol.slice(0, -1);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    // Public + private suffixes keep com.br together without merging unrelated
    // tenants on github.io, appspot.com, etc. The bundled list needs no network.
    return getDomain(host, { allowPrivateDomains: true }) || host;
  } catch {
    return 'Other pages';
  }
}

export function groupResults(ranked, query, enabled) {
  if (!enabled || !query.trim()) return ranked;
  const phrase = normalize(query).replace(/^"(.+)"$/, '$1');
  const exact = [],
    groups = new Map();
  for (const item of ranked) {
    if (item.match.tier === 4) {
      exact.push({ ...item, section: { key: 'exact', label: 'Exact matches' } });
      continue;
    }
    const domain = domainOf(item.url);
    if (!groups.has(domain)) groups.set(domain, { domain, items: [], tier: 0, recent: 0 });
    const group = groups.get(domain);
    group.items.push({ ...item, section: { key: `domain:${domain}`, label: domain } });
    group.tier = Math.max(group.tier, item.match.tier);
    group.recent = Math.max(group.recent, item.lastAccessed || 0);
  }
  const ordered = [...groups.values()].sort(
    (a, b) =>
      Number(wholePhrase(normalize(b.domain), phrase)) -
        Number(wholePhrase(normalize(a.domain), phrase)) ||
      b.tier - a.tier ||
      b.recent - a.recent ||
      a.domain.localeCompare(b.domain),
  );
  return [...exact, ...ordered.flatMap((group) => group.items)];
}

// Existing rows keep their places during interaction. Removed results disappear;
// new matches append, so counts and Select all still include every match.
export function stabilizeResults(previous, incoming, held) {
  if (!held) return incoming;
  const pending = new Map(incoming.map((item) => [item.id, item]));
  const result = [];
  for (const old of previous) {
    const fresh = pending.get(old.id);
    if (fresh) {
      result.push({ ...fresh, section: old.section });
      pending.delete(old.id);
    }
  }
  return [...result, ...pending.values()];
}

export function selectedAfterUpdate(results, previousId, previousIndex) {
  const found = results.findIndex((item) => item.id === previousId);
  return found === -1 ? Math.max(0, Math.min(previousIndex, results.length - 1)) : found;
}

// Layout contains both headings and rows, while keyboard indexes contain only
// results. Fixed heights keep thousands of matches cheap to scroll.
export function resultLayout(results) {
  const entries = [],
    tops = [];
  let height = 0;
  for (let i = 0; i < results.length; i++) {
    const section = results[i].section;
    if (section && (i === 0 || section.key !== results[i - 1].section?.key)) {
      let count = 1;
      while (i + count < results.length && results[i + count].section?.key === section.key) count++;
      entries.push({
        type: 'heading',
        label: section.label,
        count,
        top: height,
        height: HEADING_HEIGHT,
      });
      height += HEADING_HEIGHT;
    }
    tops.push(height);
    entries.push({ type: 'result', index: i, top: height, height: ROW_HEIGHT });
    height += ROW_HEIGHT;
  }
  return { entries, tops, height };
}

export function visibleRange(layout, scrollTop, viewport) {
  const { entries } = layout;
  const at = (position) => {
    let low = 0,
      high = entries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (entries[mid].top + entries[mid].height <= position) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  return {
    start: Math.max(0, at(scrollTop) - 3),
    end: Math.min(entries.length, at(scrollTop + viewport) + 4),
  };
}
