export async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok)
    throw new Error(
      response?.error || 'Tab Navigator could not connect. Close and reopen it to try again.',
    );
  return response.data;
}
export function applyTheme(theme) {
  document.documentElement.dataset.theme =
    theme === 'system'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme || 'dark';
}
export function shortcutLabel(shortcut) {
  const mac = /Mac/.test(navigator.platform);
  return shortcut
    .replace(/Command|⌘/g, '⌘')
    .replace(/MacCtrl/g, '⌃')
    .replace(/Ctrl/g, mac ? '⌃' : 'Ctrl')
    .replace(/Alt/g, mac ? '⌥' : 'Alt')
    .replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/\+/g, ' ')
    .replace(/([⌘⌃⌥⇧])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cycleShortcutHint(commands = []) {
  const key = (name, fallback) => {
    const shortcut = commands.find((command) => command.name === name)?.shortcut;
    return shortcut ? shortcutLabel(shortcut) : fallback;
  };
  return `${key('cycle-older', '↓')} moves down · ${key('cycle-newer', '↑')} moves up`;
}
