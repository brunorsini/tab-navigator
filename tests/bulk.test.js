import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkActions } from '../extension/lib/bulk.js';
function fixture(count = 80) {
  const saved = {},
    session = {},
    tabs = new Map(
      Array.from({ length: count }, (_, i) => [
        i + 1,
        {
          id: i + 1,
          windowId: 1,
          index: i,
          pinned: i === 0,
          url: `https://example.com/${i}`,
          title: `Page ${i}`,
        },
      ]),
    );
  let id = count,
    failSave = false;
  const bookmarks = [{ id: 'a', title: 'Bookmarks', children: [{ id: 'b', title: 'Folder' }] }],
    children = [],
    grouped = [];
  const api = {
    runtime: { getURL: () => 'chrome-extension://sensible/' },
    storage: {
      local: {
        get: async () => structuredClone(saved),
        set: async (values) => {
          if (failSave) throw Error('storage full');
          Object.assign(saved, structuredClone(values));
        },
      },
      session: {
        get: async () => structuredClone(session),
        set: async (values) => Object.assign(session, structuredClone(values)),
      },
    },
    scripting: {
      executeScript: async ({ target }) => [
        {
          frameId: 0,
          result: {
            status: 'clear',
            reason: 'No edits detected.',
            url: tabs.get(target.tabId).url,
            frames: 0,
          },
        },
      ],
    },
    permissions: { contains: async () => true },
    tabs: {
      query: async () => [...tabs.values()],
      get: async (id) => {
        if (!tabs.has(id)) throw Error('gone');
        return tabs.get(id);
      },
      remove: async (id) => {
        assert(saved.closedBatches?.length, 'journal must precede close');
        tabs.delete(id);
      },
      create: async (data) => {
        const tab = { id: ++id, ...data };
        tabs.set(tab.id, tab);
        return tab;
      },
      group: async (data) => {
        grouped.push(data);
        return 20;
      },
      move: async (id, data) => Object.assign(tabs.get(id), data),
    },
    windows: { get: async (id) => ({ id }), create: async () => ({ id: 2 }) },
    tabGroups: {
      query: async () => [],
      get: async (id) => ({ id, windowId: 1 }),
      update: async () => {},
    },
    bookmarks: {
      getTree: async () => bookmarks,
      getChildren: async () => children,
      create: async (item) => {
        children.push(item);
        return { id: 'c', ...item };
      },
    },
  };
  return {
    api,
    saved,
    session,
    tabs,
    children,
    grouped,
    failStorage: () => {
      failSave = true;
    },
  };
}
async function closeReviewed(bulk, ids, acknowledged = []) {
  const review = await bulk.prepareClose(ids);
  return bulk.close(ids, { token: review.token, acknowledged });
}
test('single hover-close journals the tab and the existing Undo restores it', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  assert.equal((await bulk.closeOne(2)).count, 1);
  assert.equal(f.tabs.has(2), false);
  const [batch] = await bulk.undoInfo();
  assert.equal(batch.count, 1);
  assert.equal((await bulk.undo(batch.id)).count, 1);
  assert([...f.tabs.values()].some((tab) => tab.url === 'https://example.com/1'));
});
test('explicit search closes work without website permission or input-review detours', async () => {
  const f = fixture(7),
    bulk = bulkActions(f.api);
  f.api.permissions.contains = async () => {
    throw Error('Direct close must not ask for site access');
  };
  f.api.scripting.executeScript = async () => {
    throw Error('Direct close must not scan forms');
  };
  assert.equal((await bulk.closeSelected([2, 3, 4, 5, 6])).count, 5);
  assert.equal(f.tabs.size, 2);
  const [batch] = await bulk.undoInfo();
  assert.equal(batch.count, 5);
  assert.equal((await bulk.undo(batch.id)).count, 5);
  assert.equal(f.tabs.size, 7);
  assert.equal((await bulk.closeOne(7)).count, 1);
});
test('each close has its own full minute and expires independently across worker restarts', async (t) => {
  let time = 100_000;
  t.mock.method(Date, 'now', () => time);
  const f = fixture(7),
    bulk = bulkActions(f.api);
  await bulk.closeSelected([2, 3]);
  time += 20_000;
  await bulk.closeSelected([4, 5, 6]);
  let info = await bulkActions(f.api).undoInfo();
  assert.deepEqual(
    info.map((batch) => batch.expiresAt),
    [160_000, 180_000],
  );
  const [first, second] = info;
  time = 160_001;
  info = await bulkActions(f.api).undoInfo();
  assert.deepEqual(
    info.map((batch) => batch.id),
    [second.id],
  );
  await assert.rejects(bulk.undo(first.id), /restore time has ended/);
  assert.equal((await bulk.undo(second.id)).count, 3);
  assert.equal(
    f.saved.closedBatches.length,
    0,
    'expired records are pruned on the next journal write',
  );
});
test('the full restore minute starts after closure completes, and failed restore gets a new minute', async (t) => {
  let time = 100_000;
  t.mock.method(Date, 'now', () => time);
  const f = fixture(3),
    bulk = bulkActions(f.api),
    remove = f.api.tabs.remove;
  f.api.tabs.remove = async (id) => {
    time += 5000;
    await remove(id);
  };
  await bulk.closeSelected([2]);
  const [batch] = await bulk.undoInfo();
  assert.equal(batch.expiresAt, 165_000);
  time = 160_000;
  f.api.tabs.create = async () => {
    throw Error('transient failure');
  };
  assert.equal((await bulk.undo(batch.id)).failed, 1);
  assert.equal((await bulk.undoInfo())[0].expiresAt, 220_000);
});
test('direct close still journals first and protects tabs that navigate while closing', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  const get = f.api.tabs.get;
  f.api.tabs.get = async (id) => ({ ...(await get(id)), url: 'https://changed.example/' });
  assert.equal((await bulk.closeSelected([2])).count, 0);
  assert(f.tabs.has(2));
  assert.deepEqual(await bulk.undoInfo(), []);
});
test('single hover-close does not lose a tab when Undo storage fails', async () => {
  const f = fixture(3);
  f.failStorage();
  await assert.rejects(bulkActions(f.api).closeOne(2), /storage full/);
  assert(f.tabs.has(2));
});
test('close and persistent undo recover all 80 tabs, beyond the old visible limit', async () => {
  const f = fixture(),
    bulk = bulkActions(f.api);
  const ids = [...f.tabs.keys()];
  assert.equal((await closeReviewed(bulk, ids)).count, 80);
  assert.equal(f.tabs.size, 1, 'keep an empty window alive for Undo');
  const recreated = bulkActions(f.api),
    info = await recreated.undoInfo();
  assert.equal(info[0].count, 80);
  assert.equal((await recreated.undo(info[0].id)).count, 80);
  assert.equal(f.tabs.size, 81);
  assert.deepEqual(await recreated.undoInfo(), []);
  assert([...f.tabs.values()].some((tab) => tab.pinned && tab.url === 'https://example.com/0'));
});
test('storage failure prevents any tab from closing', async () => {
  const f = fixture();
  f.failStorage();
  await assert.rejects(closeReviewed(bulkActions(f.api), [1, 2]), /storage full/);
  assert.equal(f.tabs.size, 80);
});
test('failed restores remain undoable and retry does not duplicate successful ones', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  await closeReviewed(bulk, [2, 3]);
  const id = (await bulk.undoInfo())[0].id,
    original = f.api.tabs.create;
  f.api.tabs.create = async (data) => {
    if (data.url.endsWith('/2')) throw Error('transient failure');
    return original(data);
  };
  const partial = await bulk.undo(id);
  assert.deepEqual({ count: partial.count, failed: partial.failed }, { count: 1, failed: 1 });
  assert.equal(f.tabs.get(partial.tabId).url, 'https://example.com/1');
  assert.equal((await bulk.undoInfo())[0].count, 1);
  f.api.tabs.create = original;
  const retry = await bulk.undo(id);
  assert.deepEqual({ count: retry.count, failed: retry.failed }, { count: 1, failed: 0 });
  assert.equal(f.tabs.get(retry.tabId).url, 'https://example.com/2');
  assert.equal(f.tabs.size, 3);
});
test('interrupted close journal skips tabs still open and restores missing tabs', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  await closeReviewed(bulk, [2, 3]);
  f.saved.closedBatches[0].tabs.forEach((row) => {
    row.status = 'pending';
  });
  f.tabs.set(2, { id: 2, url: 'https://example.com/1', windowId: 1 });
  assert.equal((await bulk.undo(f.saved.closedBatches[0].id)).count, 1);
  assert.equal(f.tabs.size, 3);
});
test('multiple closes retain independent undos', async () => {
  const f = fixture(4),
    bulk = bulkActions(f.api);
  await closeReviewed(bulk, [2]);
  await closeReviewed(bulk, [3]);
  const info = await bulk.undoInfo();
  assert.equal(info.length, 2);
  await bulk.undo(info[1].id);
  assert.equal((await bulk.undoInfo()).length, 1);
  await bulk.undo(info[0].id);
  assert.equal(f.tabs.size, 4);
});
test('restoring a batch targets its previously current tab, falling back to the first successful restore', async () => {
  for (const failCurrent of [false, true]) {
    const f = fixture(4),
      bulk = bulkActions(f.api),
      create = f.api.tabs.create;
    f.api.tabs.query = async (query) =>
      query.active ? [f.tabs.get(3)].filter(Boolean) : [...f.tabs.values()];
    await bulk.closeSelected([2, 3, 4]);
    if (failCurrent)
      f.api.tabs.create = async (data) => {
        if (data.url.endsWith('/2')) throw Error('failed');
        return create(data);
      };
    const result = await bulk.undo((await bulk.undoInfo())[0].id);
    assert.equal(
      f.tabs.get(result.tabId).url,
      failCurrent ? 'https://example.com/1' : 'https://example.com/2',
    );
    assert.equal(result.windowId, 1);
  }
});
test('bookmarks deduplicate URLs and can create a named subfolder', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  f.tabs.get(3).url = f.tabs.get(2).url;
  assert.deepEqual(await bulk.bookmark([2, 3], 'b', 'Saved tabs'), {
    count: 1,
    skipped: 1,
    failed: 0,
  });
  assert.equal(f.children[0].title, 'Saved tabs');
  assert.equal(f.children[1].parentId, 'c');
  await assert.rejects(bulk.bookmark([2], 'missing', ''), /available bookmark folder/);
});
test('new groups stay in original windows and reject pinned tabs before mutation', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  f.tabs.get(3).windowId = 2;
  await assert.rejects(bulk.group([1, 2], undefined, 'Work'), /Pinned/);
  assert.equal(f.grouped.length, 0);
  assert.equal((await bulk.group([2, 3], undefined, 'Work')).count, 2);
  assert.equal(f.grouped.length, 2);
});
test('a close without a valid review cannot remove any tab', async () => {
  const f = fixture(2);
  await assert.rejects(bulkActions(f.api).close([1]), /Review these tabs/);
  assert.equal(f.tabs.size, 2);
});
test('possible edits and unchecked tabs stay open unless explicitly included', async () => {
  for (const status of ['possible', 'unknown']) {
    const f = fixture(2),
      bulk = bulkActions(f.api);
    f.api.scripting.executeScript = async ({ target }) => [
      {
        frameId: 0,
        result: {
          status,
          reason: 'Attention required.',
          url: f.tabs.get(target.tabId).url,
          frames: 0,
        },
      },
    ];
    const review = await bulk.prepareClose([1, 2]);
    assert(review.rows.every((tab) => tab.check.status === status));
    const result = await bulk.close([1, 2], { token: review.token });
    assert.equal(result.count, 0);
    assert.equal(result.protected.length, 2);
    assert.equal(f.tabs.size, 2, 'do not create a blank tab for a batch that closes nothing');
    const approved = await bulk.prepareClose([2]);
    assert.equal((await bulk.close([2], { token: approved.token, acknowledged: [2] })).count, 1);
    assert.equal((await bulk.undoInfo())[0].count, 1);
  }
});
test('edits appearing after review are caught immediately before removal', async () => {
  const f = fixture(2),
    bulk = bulkActions(f.api),
    review = await bulk.prepareClose([2]);
  f.api.scripting.executeScript = async ({ target }) => [
    {
      frameId: 0,
      result: { status: 'possible', reason: 'New draft', url: f.tabs.get(target.tabId).url },
    },
  ];
  const result = await bulk.close([2], { token: review.token, acknowledged: [2] });
  assert.equal(result.count, 0);
  assert.equal(f.tabs.size, 2);
  await assert.rejects(
    bulk.close([2], { token: review.token }),
    /Review these tabs/,
    'review cannot be replayed',
  );
});
test('an unchecked acknowledgement does not approve newly detected edits', async () => {
  const f = fixture(2),
    bulk = bulkActions(f.api);
  f.api.permissions.contains = async () => false;
  const review = await bulk.prepareClose([2]);
  f.api.permissions.contains = async () => true;
  f.api.scripting.executeScript = async ({ target }) => [
    {
      frameId: 0,
      result: { status: 'possible', reason: 'Draft', url: f.tabs.get(target.tabId).url },
    },
  ];
  assert.equal((await bulk.close([2], { token: review.token, acknowledged: [2] })).count, 0);
});
test('navigation and a missing keeper invalidate duplicate closure plans', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  f.tabs.get(1).url = f.tabs.get(2).url;
  const review = await bulk.prepareClose([2], [{ url: f.tabs.get(1).url, ids: [1] }]);
  f.tabs.delete(1);
  assert.equal((await bulk.close([2], { token: review.token })).count, 0);
  const next = await bulk.prepareClose([3]);
  f.tabs.get(3).url = 'https://changed.example/';
  assert.equal((await bulk.close([3], { token: next.token })).count, 0);
});
test('a keeper disappearing during the batch preserves the remaining copy', async () => {
  const f = fixture(3),
    bulk = bulkActions(f.api);
  f.tabs.get(1).url = f.tabs.get(2).url = f.tabs.get(3).url;
  const review = await bulk.prepareClose([2, 3], [{ url: f.tabs.get(1).url, ids: [1] }]);
  const remove = f.api.tabs.remove;
  f.api.tabs.remove = async (id) => {
    await remove(id);
    f.tabs.delete(1);
  };
  const result = await bulk.close([2, 3], { token: review.token });
  assert.equal(result.count, 1);
  assert(f.tabs.has(3));
});
test('expired reviews do not close tabs', async () => {
  const f = fixture(2),
    bulk = bulkActions(f.api),
    review = await bulk.prepareClose([2]);
  f.session.closeReviews[review.token].at -= 11 * 60 * 1000;
  await assert.rejects(bulk.close([2], { token: review.token }), /Review these tabs/);
});
