// Isolated coverage of the opt-in indexer. Chrome's native permission prompt needs
// a person in headless mode, so only this disposable copy pregrants website access.
// The production manifest keeps these hosts optional; browser.mjs verifies denial.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dir = await mkdtemp(join(tmpdir(), 'relay-context-test-'));
const extension = join(dir, 'extension');
await cp(join(root, 'extension'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = manifest.optional_host_permissions;
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(join(dir, 'profile'), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const waitFor = async (fn, label) => {
  for (let i = 0; i < 80; i++) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const base = `chrome-extension://${new URL(worker.url()).host}`;
  await context.route('https://example.org/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<!doctype html><title>Context test</title><meta name="description" content="A tiny test page"><main><h1>Searchable heading</h1><p>emerald mongoose</p><input value="secret-input-token"><div contenteditable>secret-editable-token</div><div hidden>secret-hidden-token</div><p>' +
        'A long article about football. '.repeat(3000) +
        '</p><p>The ultramarine final-whistle appears at the end.</p></main>',
    }),
  );
  const page = await context.newPage();
  await page.goto('https://example.org/context');
  const options = await context.newPage();
  await options.goto(`${base}/options.html`);
  await options.locator('#page-text').check();
  await options.getByText('Saved.', { exact: true }).waitFor();
  await page.bringToFront();
  const entries = () =>
    options.evaluate(async () =>
      Object.values((await chrome.storage.session.get('contexts')).contexts || {}),
    );
  await waitFor(
    async () => (await entries()).some((item) => item.text.includes('emerald mongoose')),
    'page excerpt',
  );
  const captured = JSON.stringify(await entries());
  for (const secret of ['secret-input-token', 'secret-editable-token', 'secret-hidden-token'])
    assert(!captured.includes(secret));
  console.log(
    '✓ Opt-in capture indexes page context and excludes form, editable, and hidden content',
  );
  const popup = await context.newPage();
  await popup.goto(`${base}/popup.html`);
  await popup.locator('#search').fill('emerald mongoose');
  await popup.getByText('Page text', { exact: true }).waitFor();
  console.log('✓ Captured text is searchable through the real popup');
  await popup.locator('#search').fill('ultramarine final-whistle');
  await popup.getByText('Page text', { exact: true }).waitFor();
  assert.match(await popup.locator('.match-context').textContent(), /appears at the end/);
  console.log(
    '✓ Text beyond the first 80,000 characters is indexed and shown as a matching excerpt',
  );
  await page.close();
  await waitFor(async () => (await entries()).length === 0, 'closed tab cache removed');
  console.log('✓ Closing the page removes its saved excerpt');
  await options.locator('#page-text').uncheck();
  await waitFor(
    async () =>
      await options.evaluate(
        async () => (await chrome.scripting.getRegisteredContentScripts()).length === 0,
      ),
    'capture unregister',
  );
  assert.equal((await entries()).length, 0);
  console.log('✓ Disabling context search clears excerpts and unregisters the script');
} finally {
  await context.close();
  await rm(dir, { recursive: true, force: true });
}
