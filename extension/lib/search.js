export const normalize = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function displayUrl(value) {
  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname + url.search + url.hash);
    return url.hostname.replace(/^www\./, '') + (path === '/' ? '' : path);
  } catch {
    return String(value || '');
  }
}

function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  if (a.length === b.length) {
    const mismatch = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) mismatch.push(i);
    return (
      mismatch.length === 1 ||
      (mismatch.length === 2 &&
        mismatch[1] === mismatch[0] + 1 &&
        a[mismatch[0]] === b[mismatch[1]] &&
        a[mismatch[1]] === b[mismatch[0]])
    );
  }
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let i = 0,
    j = 0,
    skipped = false;
  while (i < short.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
    } else if (skipped) return false;
    else {
      skipped = true;
      j++;
    }
  }
  return true;
}

export function prepare(item) {
  const fields = [
    item.title,
    displayUrl(item.url),
    item.group,
    item.description,
    item.headings,
    item.text,
  ].map(normalize);
  let host = '';
  try {
    host = normalize(new URL(item.url).hostname.replace(/^www\./, ''));
  } catch {}
  return {
    ...item,
    _fields: fields,
    _host: host,
    _words: fields
      .slice(0, 4)
      .join(' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  };
}

// Boundaries prevent a site like notacme.com from receiving Acme's relevance.
export function wholePhrase(text, phrase) {
  let start = text.indexOf(phrase);
  while (start !== -1) {
    const before = [...text.slice(0, start)].at(-1) || '';
    const after = [...text.slice(start + phrase.length)][0] || '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    start = text.indexOf(phrase, start + 1);
  }
  return false;
}

export function match(item, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return { tier: 0, score: 0, reason: '' };
  const quoted = query.match(/^"(.+)"$/);
  const phrase = quoted ? quoted[1] : query;
  const prepared = item._fields ? item : prepare(item);
  const fields = prepared._fields;
  // Evaluate exact and strong fields before weaker partial/title matches.
  const exactIndex = fields.slice(0, 2).findIndex((field) => field === phrase);
  if (exactIndex !== -1 || normalize(item.url) === phrase)
    return {
      tier: 4,
      score: 0,
      reason: exactIndex === 0 ? '' : 'Exact URL',
    };
  const strongFields = [fields[0], prepared._host];
  const strongIndex = strongFields.findIndex((field) => wholePhrase(field, phrase));
  if (strongIndex !== -1) return { tier: 3, score: 0, reason: strongIndex ? 'Website match' : '' };
  const tokens = phrase.split(/\s+/).filter(Boolean).slice(0, 12);
  if (!quoted && tokens.every((token) => strongFields.some((field) => wholePhrase(field, token)))) {
    return { tier: 3, score: 0, reason: 'Title / website match' };
  }
  const fieldIndex = fields.findIndex((field) => field.includes(phrase));
  if (fieldIndex !== -1) {
    return {
      tier: 2,
      score: (6 - fieldIndex) * 100 + (fields[fieldIndex].startsWith(phrase) ? 30 : 0),
      reason: ['', 'URL match', 'Tab group', 'Description', 'Page heading', 'Page text'][
        fieldIndex
      ],
    };
  }
  if (quoted) return null;
  let score = 0,
    fuzzy = false,
    context = false;
  for (const token of tokens) {
    const index = fields.findIndex((field) => field.includes(token));
    if (index !== -1) {
      score += (6 - index) * 20;
      context ||= index >= 3;
      continue;
    }
    const words = item._words || prepare(item)._words;
    if (token.length >= 4 && words.some((word) => oneEdit(token, word))) {
      fuzzy = true;
      score += 10;
    } else return null;
  }
  return {
    tier: fuzzy ? 1 : 2,
    score,
    reason: fuzzy ? 'Close match' : context ? 'Page context' : 'All words match',
  };
}

export function rank(items, query, { currentId, order = 'recent', limit = Infinity } = {}) {
  const hasQuery = Boolean(query.trim());
  const result = [];
  for (const item of items) {
    const hit = match(item, query);
    if (hit) result.push({ ...item, match: hit });
  }
  result.sort((a, b) => {
    if (hasQuery) {
      const relevance = b.match.tier - a.match.tier;
      if (relevance) return relevance;
    }
    // Within each quality tier, recent use wins over small field/position bonuses.
    // Empty search keeps open tabs first and the current tab last.
    if (!hasQuery && a.kind !== b.kind) return a.kind === 'tab' ? -1 : 1;
    if (!hasQuery && (a.tabId === currentId) !== (b.tabId === currentId))
      return a.tabId === currentId ? 1 : -1;
    const date = (item) =>
      order === 'opened' && item.kind === 'tab'
        ? item.createdAt || item.lastAccessed
        : item.lastAccessed;
    return (
      (date(b) || 0) - (date(a) || 0) ||
      (a.kind !== b.kind ? (a.kind === 'tab' ? -1 : 1) : 0) ||
      (hasQuery ? b.match.score - a.match.score : 0) ||
      String(a.title).localeCompare(String(b.title)) ||
      String(a.id).localeCompare(String(b.id))
    );
  });
  return result.slice(0, limit);
}

export function combine(tabs, history, includeTabs, includeHistory) {
  const open = new Set(includeTabs ? tabs.map((tab) => tab.url) : []);
  return [
    ...(includeTabs ? tabs : []),
    ...(includeHistory ? history.filter((item) => !open.has(item.url)) : []),
  ];
}

export function excerpt(item, query) {
  const tokens = normalize(query).replace(/"/g, '').split(/\s+/).filter(Boolean);
  for (const field of [item.description, item.headings, item.text]) {
    if (!field) continue;
    const cleaned = field.replace(/\s+/g, ' ').trim();
    const normalized = normalize(cleaned);
    const positions = tokens
      .map((token) => normalized.indexOf(token))
      .filter((index) => index >= 0);
    if (!positions.length) continue;
    const start = Math.max(0, Math.min(...positions) - 35);
    return `${start ? '…' : ''}${cleaned.slice(start, start + 135)}${cleaned.length > start + 135 ? '…' : ''}`;
  }
  return '';
}
