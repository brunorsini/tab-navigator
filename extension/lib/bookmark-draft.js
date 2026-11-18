export const draftKey = (id) => `bookmarkDraft:${id}`;
export async function createBookmarkDraft(api, tabs) {
  const id = crypto.randomUUID();
  const draft = {
    id,
    at: Date.now(),
    folderId: '',
    title: '',
    state: 'pending',
    tabs: tabs
      .map((tab) => ({
        tabId: tab.tabId,
        title: tab.title,
        url: tab.url,
      }))
      .filter((tab) => /^(https?:|file:|chrome:|about:blank)/.test(tab.url || '')),
  };
  if (!draft.tabs.length) throw Error('No bookmarkable tabs were selected.');
  draft.originalCount = draft.tabs.length;
  draft.originalUniqueCount = new Set(draft.tabs.map((tab) => tab.url)).size;
  await api.storage.local.set({ [draftKey(id)]: draft, latestBookmarkDraft: id });
  return draft;
}
export async function loadBookmarkDraft(api, id) {
  return (await api.storage.local.get(draftKey(id)))[draftKey(id)];
}
export async function saveBookmarkDraft(api, draft) {
  await api.storage.local.set({ [draftKey(draft.id)]: draft });
}
export async function pendingBookmarkDraft(api) {
  const { latestBookmarkDraft } = await api.storage.local.get('latestBookmarkDraft');
  if (!latestBookmarkDraft) return null;
  const draft = await loadBookmarkDraft(api, latestBookmarkDraft);
  return draft?.state === 'pending' && draft.tabs.length ? draft : null;
}
