import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, rank, combine, normalize, excerpt } from '../extension/lib/search.js';
const tab = (id, title, url = 'https://example.com', extra = {}) =>
  prepare({ id: `tab-${id}`, tabId: id, kind: 'tab', title, url, lastAccessed: id, ...extra });
test('exact phrases rank ahead of partial words and typos', () => {
  const items = [
    tab(1, 'Chromium tab extensions'),
    tab(2, 'Chrome extensions'),
    tab(3, 'Chrome extensons'),
    tab(4, 'An introduction to Chrome extensions'),
  ];
  assert.deepEqual(
    rank(items, 'chrome extensions').map((item) => item.tabId),
    [2, 4, 3],
  );
});
test('every query word must match, across title, URL, and group', () => {
  const items = [
    tab(1, 'Planning the launch', 'https://notion.so/roadmap', { group: 'Work' }),
    tab(2, 'Planning', 'https://notion.so/notes'),
  ];
  assert.deepEqual(
    rank(items, 'launch notion work').map((item) => item.tabId),
    [1],
  );
  assert.equal(rank(items, 'launch unrelated').length, 0);
});
test('accents and case normalize; non-Latin searches work', () => {
  assert.equal(normalize('  SÃO   PAULO '), 'sao paulo');
  assert.equal(rank([tab(1, 'Café em São Paulo')], 'cafe sao').length, 1);
  assert.equal(rank([tab(1, '東京の旅行')], '東京').length, 1);
});
test('typo matching handles insertion, deletion, substitution and transposition', () => {
  for (const query of ['notiom', 'notionn', 'notin', 'noiton'])
    assert.equal(rank([tab(1, 'Notion')], query).length, 1, query);
  assert.equal(rank([tab(1, 'Notion')], 'nomore').length, 0);
});
test('quoted phrase disables fuzzy and separated word matching', () => {
  const items = [
    tab(1, 'Chrome browser extensions'),
    tab(2, 'Chrome extensions'),
    tab(3, 'Chrome extensons'),
  ];
  assert.deepEqual(
    rank(items, '"chrome extensions"').map((item) => item.tabId),
    [2],
  );
});
test('page text participates but title matches rank higher', () => {
  const result = rank(
    [tab(1, 'Notes', '', { text: 'The counterpress is useful.' }), tab(2, 'Counterpress')],
    'counterpress',
  );
  assert.equal(result[0].tabId, 2);
  assert.equal(result[1].match.reason, 'Page text');
});
test('matching excerpts locate text deep in long pages without returning the entire document', () => {
  const item = tab(1, 'A long article', '', {
    text: 'Some other details. '.repeat(5000) + 'Ultramarine football tactics make the difference.',
  });
  const snippet = excerpt(item, 'ultramarine football');
  assert.match(snippet, /Ultramarine football tactics/);
  assert(snippet.length < 140);
  assert.equal(rank([item], 'ultramarine football')[0].match.reason, 'Page text');
});
test('empty search puts previous tab first and current tab last', () => {
  assert.deepEqual(
    rank([tab(1, 'First'), tab(2, 'Second'), tab(3, 'Current')], '', { currentId: 3 }).map(
      (item) => item.tabId,
    ),
    [2, 1, 3],
  );
});
test('newly opened order uses tracked creation times', () => {
  const items = [
    tab(1, 'Older', '', { lastAccessed: 100, createdAt: 1 }),
    tab(2, 'New', '', { lastAccessed: 2, createdAt: 20 }),
  ];
  assert.equal(rank(items, '', { order: 'opened' })[0].tabId, 2);
});
test('history is deduplicated against open tabs only when tabs are enabled', () => {
  const tabs = [tab(1, 'One')],
    history = [prepare({ kind: 'history', url: 'https://example.com', title: 'One' })];
  assert.equal(combine(tabs, history, true, true).length, 1);
  assert.equal(combine(tabs, history, false, true).length, 1);
  assert.equal(combine(tabs, history, false, false).length, 0);
});
test('exact history matches can beat fuzzy tab matches', () => {
  const history = prepare({ kind: 'history', title: 'YouTube', url: 'https://youtube.com' });
  assert.equal(rank([tab(1, 'YouTub'), history], 'youtube')[0].kind, 'history');
});
test('large indexes return the full count and preserve optional explicit limits', () => {
  const items = Array.from({ length: 2500 }, (_, i) =>
    tab(i, `Project document ${i}`, `https://example.com/item/${i}`),
  );
  const start = performance.now();
  assert.equal(rank(items, 'project document 2499')[0].tabId, 2499);
  assert.equal(rank(items, '').length, 2500);
  assert.equal(rank(items, 'project document').length, 2500);
  assert.equal(rank(items, '', { limit: 60 }).length, 60);
  console.log(`Search over 2,500 items: ${(performance.now() - start).toFixed(1)}ms`);
});
