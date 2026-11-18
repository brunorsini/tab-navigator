import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleShortcutHint } from '../extension/lib/client.js';

function platform(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: value },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  });
}

test('cycle hints use the actual macOS bindings, including legacy numeric mappings', (t) => {
  platform(t, 'MacIntel');
  assert.equal(
    cycleShortcutHint([
      { name: 'cycle-older', shortcut: '⌃⇧7' },
      { name: 'cycle-newer', shortcut: '⌃⇧8' },
    ]),
    '⌃ ⇧ 7 moves down · ⌃ ⇧ 8 moves up',
  );
  assert.equal(
    cycleShortcutHint([
      { name: 'cycle-older', shortcut: '⌥R' },
      { name: 'cycle-newer', shortcut: '⌥⇧R' },
    ]),
    '⌥ R moves down · ⌥ ⇧ R moves up',
  );
});

test('custom reverse keys are shown without assuming a Shift variant', (t) => {
  platform(t, 'Win32');
  assert.equal(
    cycleShortcutHint([
      { name: 'cycle-older', shortcut: 'Alt+R' },
      { name: 'cycle-newer', shortcut: 'Ctrl+Shift+Y' },
    ]),
    'Alt R moves down · Ctrl Shift Y moves up',
  );
});

test('unassigned commands fall back to working arrow navigation', (t) => {
  platform(t, 'Win32');
  assert.equal(cycleShortcutHint(), '↓ moves down · ↑ moves up');
  assert.equal(
    cycleShortcutHint([
      { name: 'cycle-older', shortcut: 'Alt+R' },
      { name: 'cycle-newer', shortcut: '' },
    ]),
    'Alt R moves down · ↑ moves up',
  );
});
