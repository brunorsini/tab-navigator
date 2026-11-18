import { normalize } from './search.js';

// Return offsets into the original text, keeping every UTF-16 code unit aligned
// with String.indexOf(), including the two units used by most emoji.
export function highlightRanges(text, query) {
  text = String(text ?? '');
  query = String(query ?? '');
  const tokens = normalize(query).replace(/"/g, '').split(' ').filter(Boolean);
  if (!tokens.length) return [];
  let normalized = '';
  const map = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i));
    const value = normalize(char) || (/\s/.test(char) ? ' ' : '');
    normalized += value;
    for (let unit = 0; unit < value.length; unit++) map.push({ start: i, end: i + char.length });
    // Keep a decomposed accent with the character it belongs to.
    if (!value && /^[\u0300-\u036f]+$/.test(char) && map.length)
      map[map.length - 1].end = i + char.length;
    i += char.length;
  }
  const ranges = [];
  for (const token of tokens) {
    let start = normalized.indexOf(token);
    while (start >= 0) {
      const first = map[start],
        last = map[start + token.length - 1];
      // A title should still render even if an unexpected Unicode mapping fails.
      if (first && last) ranges.push([first.start, last.end]);
      start = normalized.indexOf(token, start + token.length);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}
