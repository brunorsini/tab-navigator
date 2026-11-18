import { request, applyTheme, shortcutLabel } from './lib/client.js';
const $ = (id) => document.getElementById(id);
const ORIGINS = ['http://*/*', 'https://*/*'];
let prefs;
const status = (text) => {
  $('status').textContent = text;
};
function sync() {
  $('page-text').checked = prefs.pageText;
  $('current-window').checked = prefs.currentWindow;
  $('theme').value = prefs.theme;
  applyTheme(prefs.theme);
}
async function save(patch) {
  try {
    prefs = await request('settings', { settings: patch });
    sync();
    status('Saved.');
  } catch (error) {
    sync();
    status(error.message);
    throw error;
  }
}
async function load() {
  try {
    const data = await request('snapshot');
    prefs = data.settings;
    sync();
    const labels = {
      _execute_action: 'Find a tab',
      'toggle-last': 'Jump to the last tab',
      'cycle-older': 'Cycle through recent tabs',
      'cycle-newer': 'Cycle in the other direction',
    };
    $('shortcuts').replaceChildren();
    for (const name of Object.keys(labels)) {
      const command = data.commands.find((item) => item.name === name);
      const row = document.createElement('div');
      row.className = 'settings-row';
      const label = document.createElement('span');
      label.className = 'setting-name';
      label.textContent = labels[name];
      const value = document.createElement('span');
      value.className = 'shortcut-value';
      if (command?.shortcut)
        for (const key of shortcutLabel(command.shortcut).split(' ')) {
          const kbd = document.createElement('kbd');
          kbd.textContent = key;
          value.append(kbd);
        }
      else {
        value.classList.add('unassigned');
        value.textContent = 'Unassigned';
      }
      row.append(label, value);
      $('shortcuts').append(row);
    }
  } catch (error) {
    status(error.message);
  }
}
$('edit-shortcuts').addEventListener('click', () =>
  request('shortcuts').catch((error) => status(error.message)),
);
$('page-text').addEventListener('change', async (event) => {
  const enabled = event.target.checked;
  event.target.disabled = true;
  try {
    if (enabled) {
      const granted = await chrome.permissions.request({ origins: ORIGINS });
      if (!granted) {
        event.target.checked = false;
        status('Website access was not granted. Title, URL, and group search still work.');
        return;
      }
    }
    await save({ pageText: enabled });
    if (!enabled) await chrome.permissions.remove({ origins: ORIGINS });
  } catch (error) {
    sync();
    status(error.message);
  } finally {
    event.target.disabled = false;
  }
});
$('current-window').addEventListener('change', () =>
  save({ currentWindow: $('current-window').checked }).catch(() => {}),
);
$('theme').addEventListener('change', () => save({ theme: $('theme').value }).catch(() => {}));
$('clear-context').addEventListener('click', async () => {
  try {
    await request('clear-context');
    status('Saved page excerpts cleared.');
  } catch (error) {
    status(error.message);
  }
});
window.addEventListener('focus', load);
await load();
