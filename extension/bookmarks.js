import { request, applyTheme } from './lib/client.js';
import { draftKey, loadBookmarkDraft, saveBookmarkDraft } from './lib/bookmark-draft.js';
const $ = (id) => document.getElementById(id),
  id = new URLSearchParams(location.search).get('draft');
let draft,
  busy = false,
  allowed = false,
  limit = 30,
  saving = Promise.resolve(),
  ready = false;
const message = (text, error = false) => {
  $('bookmark-notice').textContent = text;
  $('bookmark-notice').hidden = !text;
  $('bookmark-notice').classList.toggle('error', error);
};
function remember() {
  const snapshot = structuredClone(draft);
  saving = saving.catch(() => {}).then(() => saveBookmarkDraft(chrome, snapshot));
  saving.catch((error) => message(`Could not keep your selection: ${error.message}`, true));
  return saving;
}
function sync() {
  if (!draft) return;
  const complete = draft.state === 'complete';
  $('selected-count').textContent = (
    complete ? draft.originalCount : draft.tabs.length
  ).toLocaleString();
  $('unique-count').textContent = (
    complete ? draft.originalUniqueCount : new Set(draft.tabs.map((tab) => tab.url)).size
  ).toLocaleString();
  $('permission-card').hidden = allowed || complete;
  $('folder-card').hidden = !allowed || complete;
  $('save-bookmarks').disabled =
    busy || !ready || !allowed || complete || !draft.folderId || !draft.tabs.length;
  $('save-bookmarks').textContent = busy
    ? 'Saving…'
    : complete
      ? 'Saved'
      : `Save ${new Set(draft.tabs.map((tab) => tab.url)).size} bookmarks`;
  $('bookmark-summary').textContent = 'Your tabs stay open.';
  $('bookmark-heading').textContent = complete
    ? 'Saved to Chrome bookmarks'
    : 'Save to Chrome bookmarks';
  $('bookmark-intro').textContent = complete
    ? 'You can find these pages in your chosen Chrome bookmark folder.'
    : 'Choose a Chrome bookmark folder for these pages.';
  $('discard-draft').textContent = complete ? 'Done' : 'Cancel';
  $('save-bookmarks').hidden = complete;
  $('bookmark-preview').hidden = complete;
  for (const key of [
    'bookmark-destination',
    'bookmark-name',
    'allow-bookmarks',
    'discard-draft',
    'close-bookmarks',
  ])
    $(key).disabled = busy;
  $('bookmark-destination').disabled ||= Boolean(draft.createdFolderId);
  $('bookmark-name').disabled ||= Boolean(draft.createdFolderId);
  $('bookmark-selection-title').textContent = complete
    ? 'Completed selection'
    : `Selected pages (${draft.tabs.length})`;
  $('bookmark-list').replaceChildren(
    ...draft.tabs.slice(0, limit).map((tab) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      const title = document.createElement('strong');
      title.textContent = tab.title;
      const url = document.createElement('span');
      url.textContent = tab.url;
      item.append(title, url);
      return item;
    }),
  );
  $('bookmark-more').hidden = draft.tabs.length <= limit;
}
async function loadFolders() {
  allowed = await chrome.permissions.contains({ permissions: ['bookmarks'] });
  if (allowed && draft.state !== 'complete') {
    const folders = await request('bookmark-folders');
    $('bookmark-destination').replaceChildren();
    for (const folder of folders) {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.title;
      $('bookmark-destination').append(option);
    }
    if (!folders.some((folder) => folder.id === draft.folderId))
      draft.folderId = folders[0]?.id || '';
    $('bookmark-destination').value = draft.createdFolderId || draft.folderId;
    $('bookmark-name').value = draft.title || '';
    await remember();
  }
  sync();
}
$('allow-bookmarks').addEventListener('click', async () => {
  try {
    // Selection was written to local storage before this page was opened.
    if (!(await chrome.permissions.request({ permissions: ['bookmarks'] }))) {
      message('Bookmark access was not granted. Try again or cancel.');
      return;
    }
    await loadFolders();
    message('');
  } catch (error) {
    message(error.message, true);
  }
});
$('bookmark-destination').addEventListener('change', () => {
  draft.folderId = $('bookmark-destination').value;
  remember();
  sync();
});
$('bookmark-name').addEventListener('input', () => {
  draft.title = $('bookmark-name').value;
  remember();
});
$('bookmark-more').addEventListener('click', () => {
  limit += 30;
  sync();
});
$('save-bookmarks').addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  sync();
  try {
    await saving;
    const result = await request('bookmark-draft', { id });
    draft = await loadBookmarkDraft(chrome, id);
    message(
      `${result.count} bookmarks saved.${result.skipped ? ` ${result.skipped} duplicate addresses skipped.` : ''}${result.failed ? ` ${result.failed} could not be saved; those remain selected for retry.` : ' Your tabs stayed open.'}`,
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    sync();
  }
});
async function cancel() {
  if (busy) return;
  await saving.catch(() => {});
  await chrome.storage.local.remove(draftKey(id));
  window.close();
}
$('discard-draft').addEventListener('click', () =>
  cancel().catch((error) => message(error.message, true)),
);
$('close-bookmarks').addEventListener('click', () =>
  cancel().catch((error) => message(error.message, true)),
);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel().catch((error) => message(error.message, true));
  }
});
try {
  draft = await loadBookmarkDraft(chrome, id);
  if (!draft)
    throw Error(
      'This saved selection was not found. Select tabs in search and choose Add to bookmark folder.',
    );
  const snapshot = await request('snapshot');
  applyTheme(snapshot.settings.theme);
  ready = Boolean(snapshot.closeReviewVersion);
  if (!ready)
    message(
      'Reload the extension in Chrome’s Extensions page, then reload this page to finish the update.',
      true,
    );
  await loadFolders();
} catch (error) {
  message(error.message, true);
}
