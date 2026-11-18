import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, rank } from '../extension/lib/search.js';
import {
  domainOf,
  groupResults,
  stabilizeResults,
  selectedAfterUpdate,
  resultLayout,
  visibleRange,
  ROW_HEIGHT,
  HEADING_HEIGHT,
} from '../extension/lib/result-view.js';

const tab = (id, title, url, lastAccessed = id, extra = {}) =>
  prepare({ id: `tab-${id}`, tabId: id, kind: 'tab', title, url, lastAccessed, ...extra });
const ids = (items) => items.map((item) => item.tabId);

test('exact title and URL beat newer strong matches; strong title and website use recency', () => {
  const items = [
    tab(1, 'Acme', 'https://example.com', 1),
    tab(2, 'Acme guide', 'https://example.com/guide', 10),
    tab(3, 'Admin', 'https://cnn.acme.com.br/admin', 200),
    tab(4, 'Project', 'https://github.com/acme/project', 1000),
    tab(5, 'Acmeish notes', 'https://example.com/notes', 2000),
    tab(6, 'Research', 'https://elsewhere.com', 3000, { text: 'acme' }),
    tab(7, 'Acmd', 'https://example.com/typo', 4000),
  ];
  assert.deepEqual(ids(rank(items, 'acme')), [1, 3, 2, 6, 5, 4, 7]);
  assert.equal(
    rank(
      [
        tab(8, 'acme.com.br old notes', 'https://elsewhere.com', 100),
        tab(9, 'Home', 'https://acme.com.br', 1),
      ],
      'acme.com.br',
    )[0].tabId,
    9,
  );
});

test('a partial title does not hide a stronger hostname; domain labels require boundaries', () => {
  const result = rank(
    [
      tab(1, 'Acmeish notes', 'https://docs.acme.com.br', 1),
      tab(2, 'Other', 'https://notacme.com', 100),
    ],
    'acme',
  );
  assert.deepEqual(ids(result), [1, 2]);
  assert.equal(result[0].match.reason, 'Website match');
  assert.equal(result[1].match.tier, 2);
});

test('all whole words across title and hostname share the strong tier', () => {
  const items = [
    tab(1, 'Acme admin guide', 'https://example.com', 1),
    tab(2, 'Admin', 'https://acme.com.br', 100),
  ];
  assert.deepEqual(ids(rank(items, 'acme admin')), [2, 1]);
  assert.deepEqual(ids(rank(items, '"acme admin"')), [1]);
});

test('grouping uses registered domains, including country suffixes and private hosting', () => {
  assert.equal(domainOf('https://docs.acme.com.br/path'), 'acme.com.br');
  assert.equal(domainOf('https://cnn.acme.com.br'), 'acme.com.br');
  assert.equal(domainOf('https://a.example.co.uk'), 'example.co.uk');
  assert.equal(domainOf('https://docs.alice.github.io'), 'alice.github.io');
  assert.equal(domainOf('https://bob.github.io'), 'bob.github.io');
  assert.equal(domainOf('http://localhost:1234'), 'localhost');
  assert.equal(domainOf('http://127.0.0.1:1234'), '127.0.0.1');
  assert.equal(domainOf('file:///tmp/test.html'), 'Local files');
  assert.equal(domainOf('chrome://extensions'), 'Chrome');
  assert.equal(domainOf('not a url'), 'Other pages');
});

test('exact matches remain above groups, then the named website before GitHub mentions', () => {
  const items = [
    tab(1, 'Acme', 'https://github.com/exact', 1),
    tab(2, 'Acme latest repo', 'https://github.com/acme/repo', 1000),
    tab(3, 'Guide', 'https://docs.acme.com.br/guide', 20),
    tab(4, 'Admin', 'https://cnn.acme.com.br/admin', 30),
    tab(5, 'Old project', 'https://github.com/acme/old', 5),
  ];
  const ranked = rank(items, 'acme'),
    grouped = groupResults(ranked, 'acme', true);
  assert.deepEqual(ids(grouped), [1, 4, 3, 2, 5]);
  assert.deepEqual(
    grouped.map((x) => x.section.label),
    ['Exact matches', 'acme.com.br', 'acme.com.br', 'github.com', 'github.com'],
  );
  assert.deepEqual(groupResults(ranked, 'acme', false), ranked);
  assert.deepEqual(groupResults(rank(items, ''), '', true), rank(items, ''));
});

test('interaction freezes order despite ranking updates and appends delayed results', () => {
  const previous = groupResults(
    rank(
      [
        tab(1, 'Acme docs', 'https://acme.com.br', 100),
        tab(2, 'Acme code', 'https://github.com/acme', 1),
      ],
      'acme',
    ),
    'acme',
    true,
  );
  const incoming = groupResults(
    rank(
      [
        tab(1, 'Acme docs updated', 'https://acme.com.br', 1),
        tab(2, 'Acme', 'https://github.com/acme', 500),
        tab(3, 'Acme', 'https://another.com', 600),
      ],
      'acme',
    ),
    'acme',
    true,
  );
  const frozen = stabilizeResults(previous, incoming, true);
  assert.deepEqual(ids(frozen), [1, 2, 3]);
  assert.equal(frozen[0].title, 'Acme docs updated');
  assert.equal(frozen[1].section.label, 'github.com');
  assert.equal(selectedAfterUpdate(frozen, 'tab-2', 1), 1);
  assert.deepEqual(ids(stabilizeResults(previous, incoming, false)), [3, 2, 1]);
  const remaining = stabilizeResults(
    frozen,
    incoming.filter((x) => x.tabId !== 1),
    true,
  );
  assert.deepEqual(ids(remaining), [2, 3]);
  assert.equal(selectedAfterUpdate(remaining, 'tab-2', 1), 0);
  assert.equal(selectedAfterUpdate(remaining, 'tab-1', 0), 0);
  assert.equal(selectedAfterUpdate([], 'tab-1', 5), 0);
});

test('headings have separate offsets and virtual scrolling reaches every result', () => {
  const items = Array.from({ length: 2500 }, (_, i) =>
    tab(i, 'Acme document', `https://${i % 2 ? 'acme.com.br' : 'example.com'}/${i}`),
  );
  const start = performance.now();
  const results = groupResults(rank(items, 'acme'), 'acme', true),
    layout = resultLayout(results);
  assert.equal(layout.height, 2500 * ROW_HEIGHT + 2 * HEADING_HEIGHT);
  assert.equal(layout.tops[0], HEADING_HEIGHT);
  assert.equal(layout.tops[1250], 1250 * ROW_HEIGHT + 2 * HEADING_HEIGHT);
  assert.deepEqual(
    layout.entries.filter((e) => e.type === 'heading').map((e) => e.count),
    [1250, 1250],
  );
  for (const index of [0, 5, 1249, 1250, 2499]) {
    const { start, end } = visibleRange(layout, layout.tops[index], 350);
    assert(layout.entries.slice(start, end).some((e) => e.index === index));
    assert(end - start < 15);
  }
  assert.deepEqual(visibleRange(resultLayout([]), 0, 350), { start: 0, end: 0 });
  console.log(`Rank, group and lay out 2,500 matches: ${(performance.now() - start).toFixed(1)}ms`);
});
