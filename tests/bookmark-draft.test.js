import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBookmarkDraft,
  loadBookmarkDraft,
  saveBookmarkDraft,
  pendingBookmarkDraft,
} from '../extension/lib/bookmark-draft.js';
import { bulkActions } from '../extension/lib/bulk.js';
function fixture() {
  const local = {},
    folders = [{ id: 'root', title: 'Bookmarks', children: [] }],
    items = [];
  let allowed = false,
    next = 0,
    failure = '';
  const api = {
    runtime: { getURL: () => 'chrome-extension://test/' },
    storage: {
      local: {
        get: async () => structuredClone(local),
        set: async (patch) => Object.assign(local, structuredClone(patch)),
      },
    },
    permissions: { contains: async () => allowed },
    bookmarks: {
      getTree: async () => folders,
      getChildren: async (id) => items.filter((item) => item.parentId === id),
      create: async (data) => {
        if (data.url === failure) throw Error('failed');
        const item = { id: String(++next), ...data };
        items.push(item);
        if (!data.url) folders[0].children.push({ ...item, children: [] });
        return item;
      },
    },
  };
  return {
    api,
    items,
    allow: () => {
      allowed = true;
    },
    fail: (url) => {
      failure = url;
    },
  };
}
test('all 128 selected addresses survive permission approval and a new page instance', async () => {
  const f = fixture(),
    tabs = Array.from({ length: 128 }, (_, id) => ({
      tabId: id,
      title: `Tab ${id}`,
      url: `https://acme.com.br/${id}`,
    }));
  const draft = await createBookmarkDraft(f.api, tabs);
  // The popup and its in-memory data can now disappear.
  tabs[0].url = 'https://navigated.example/';
  const reopened = await loadBookmarkDraft(f.api, draft.id);
  assert.equal(
    (await pendingBookmarkDraft(f.api)).id,
    draft.id,
    'search can resume the saved selection after its page closes',
  );
  assert.equal(reopened.tabs.length, 128);
  assert.equal(reopened.tabs[0].url, 'https://acme.com.br/0');
  f.allow();
  reopened.folderId = 'root';
  await saveBookmarkDraft(f.api, reopened);
  const result = await bulkActions(f.api).bookmarkDraft(draft.id);
  assert.equal(result.count, 128);
  assert.equal((await loadBookmarkDraft(f.api, draft.id)).state, 'complete');
  assert.equal(await pendingBookmarkDraft(f.api), null, 'completed tasks disappear from search');
  await bulkActions(f.api).bookmarkDraft(draft.id);
  assert.equal(
    f.items.filter((item) => item.url).length,
    128,
    'a repeated submission must not duplicate bookmarks',
  );
});
test('denying permission leaves the saved selection untouched', async () => {
  const f = fixture(),
    draft = await createBookmarkDraft(f.api, [{ tabId: 1, title: 'Draft', url: 'https://x.com' }]);
  draft.folderId = 'root';
  await saveBookmarkDraft(f.api, draft);
  await assert.rejects(bulkActions(f.api).bookmarkDraft(draft.id), /Allow bookmark access/);
  assert.equal((await loadBookmarkDraft(f.api, draft.id)).tabs.length, 1);
  assert.equal(f.items.length, 0);
});
test('partial bookmark failures retain the failed entries and reuse their new folder', async () => {
  const f = fixture();
  f.allow();
  f.fail('https://b.com');
  const draft = await createBookmarkDraft(f.api, [
    { url: 'https://a.com', title: 'A' },
    { url: 'https://b.com', title: 'B' },
    { url: 'https://a.com', title: 'Duplicate' },
  ]);
  draft.folderId = 'root';
  draft.title = 'Acme research';
  await saveBookmarkDraft(f.api, draft);
  const bulk = bulkActions(f.api);
  assert.deepEqual(await bulk.bookmarkDraft(draft.id), { count: 1, skipped: 1, failed: 1 });
  const remaining = await loadBookmarkDraft(f.api, draft.id);
  assert.equal(remaining.tabs.length, 1);
  assert(remaining.createdFolderId);
  f.fail('');
  assert.equal((await bulk.bookmarkDraft(draft.id)).count, 1);
  assert.equal(f.items.filter((item) => !item.url).length, 1);
  assert.equal(f.items.filter((item) => item.url).length, 2);
});
