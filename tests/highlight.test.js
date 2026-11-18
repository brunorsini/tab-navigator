import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightRanges } from '../extension/lib/highlight.js';

const matches = (text, query) =>
  highlightRanges(text, query).map(([start, end]) => text.slice(start, end));

test('YouTube at the end of an emoji title highlights without crashing', () => {
  for (const title of [
    '🎵 Music for thinking — YouTube',
    '🦊🎙️ Interview — YouTube',
    '👨‍👩‍👧‍👦 Family — YouTube',
  ]) {
    assert.deepEqual(matches(title, 'youtube'), ['YouTube']);
  }
});
test('emoji queries and text after emoji retain their original offsets', () => {
  assert.deepEqual(matches('🎵 YouTube 🎵 YouTube', 'youtube 🎵'), [
    '🎵',
    'YouTube',
    '🎵',
    'YouTube',
  ]);
  assert.deepEqual(matches('𝟙 YouTube 🎵', '1 youtube'), ['𝟙', 'YouTube']);
});
test('decoded Unicode URL paths highlight without splitting surrogate pairs', () => {
  assert.deepEqual(matches('example.org/🎵/youtube', 'youtube'), ['youtube']);
});
test('accent folding and compatibility expansions preserve the displayed characters', () => {
  assert.deepEqual(matches('🎵 Café cafe\u0301', 'cafe'), ['Café', 'cafe\u0301']);
  assert.deepEqual(matches('🎵 ﬁlm', 'film'), ['ﬁlm']);
});
test('empty and unmatched queries do not create highlight ranges', () => {
  assert.deepEqual(highlightRanges('🎵 YouTube', ''), []);
  assert.deepEqual(highlightRanges('🎵 YouTube', 'vimeo'), []);
});
test('mixed Unicode titles always produce in-bounds highlight offsets', () => {
  const parts = ['🧭', '👩🏽‍✈️', '🐕', '𝟙', 'ﬁ', 'İ', 'e\u0301', '🇧🇷', '航海', '\u200d', ' ', 'Acme'];
  for (let i = 0; i < 500; i++) {
    const text =
      parts[i % parts.length] +
      parts[(i * 7) % parts.length] +
      ' — YouTube ' +
      parts[(i * 11) % parts.length];
    for (const query of ['youtube', 'acme', '🧭', 'fi', 'e', 'İ', '航海']) {
      for (const [start, end] of highlightRanges(text, query))
        assert(start >= 0 && end <= text.length && end > start);
    }
    assert(matches(text, 'youtube').includes('YouTube'));
  }
  assert.deepEqual(highlightRanges(null, 'youtube'), []);
});
