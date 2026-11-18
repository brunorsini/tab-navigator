import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

// Confirm the new-install defaults are actually registered by Chrome on macOS.
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
    assert.equal(commands.find((command) => command.name === '_execute_action').shortcut, '⌃E');
    assert.equal(commands.find((command) => command.name === 'cycle-older').shortcut, '⌥R');
    assert.equal(commands.find((command) => command.name === 'cycle-newer').shortcut, '⌥⇧R');
    assert.equal(commands.find((command) => command.name === 'toggle-last').shortcut, '⌥Q');
    console.log('✓ Chrome registers all four default shortcuts');
  } finally {
    await context.close();
  }
} else {
  console.log('macOS-specific shortcut assignment check skipped on this platform');
}
