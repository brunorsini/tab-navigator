import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Uncommon macOS suggestions should register without overriding standard browser keys.
if (process.platform === 'darwin') {
  const extension = resolve(import.meta.dirname, '../extension');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.equal(commands.find((command) => command.name === 'cycle-older').shortcut, '⌃⇧7');
    assert.equal(commands.find((command) => command.name === 'cycle-newer').shortcut, '⌃⇧8');
    assert.equal(commands.find((command) => command.name === 'toggle-last').shortcut, '⌃⇧9');
    console.log('✓ Chrome registers the three uncommon Keyboard Maestro target keys');
  } finally {
    await context.close();
  }
} else {
  console.log('macOS-specific shortcut assignment check skipped on this platform');
}
