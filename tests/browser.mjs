import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'relay-test-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1000, height: 950 },
  args: [
    `--disable-extensions-except=${join(root, 'extension')}`,
    `--load-extension=${join(root, 'extension')}`,
  ],
});
const errors = [],
  checks = [];
context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
const check = (name) => {
  checks.push(name);
  console.log(`✓ ${name}`);
};
const waitFor = async (fn, label) => {
  for (let i = 0; i < 60; i++) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}`;
  const fixtures = [
    [
      'https://www.youtube.com/watch?v=relay-test',
      '🎵 The art of the counterpress — YouTube',
      'Learn how a compact midfield wins the ball back.',
      'youtube.ico',
    ],
    [
      'https://www.notion.so/workspace/weekly-plan',
      'Weekly plan · Personal workspace',
      'Plans, notes, and the next good idea.',
      'notion.ico',
    ],
    [
      'https://github.com/example/tab-navigator',
      'Tab Navigator — Source code',
      'A lightweight tab switcher.',
      'github.ico',
    ],
    [
      'https://developer.chrome.com/docs/extensions/ai/build-with-ai',
      'Build extensions with coding agents',
      'Modern web guidance for Chrome extensions.',
      'chrome.png',
    ],
    [
      'https://open.spotify.com/playlist/relay-test',
      'Late night focus — Spotify',
      'A soundtrack for deep work.',
      'spotify.ico',
    ],
    [
      'https://www.figma.com/design/relay-test',
      'Tab Navigator / Interface — Figma',
      'Color, typography, and rhythm.',
      'figma.ico',
    ],
  ];
  const fixtureIcons = new Map(
    await Promise.all(
      fixtures.map(async (fixture) => [
        fixture[3],
        `data:image/${fixture[3].endsWith('.png') ? 'png' : 'x-icon'};base64,${(await readFile(join(root, 'tests/fixtures/favicons', fixture[3]))).toString('base64')}`,
      ]),
    ),
  );
  await context.route('https://**/*', async (route) => {
    const fixture = fixtures.find(([url]) => url === route.request().url());
    if (fixture)
      await route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><meta charset="utf-8"><title>${fixture[1]}</title><link rel="icon" href="${fixtureIcons.get(fixture[3])}"><meta name="description" content="${fixture[2]}"><main><h1>${fixture[1]}</h1><p>${fixture[2]}</p><p>Unique searchable phrase: emerald mongoose.</p><input value="secret-input-token"><div contenteditable>secret-editable-token</div><div hidden>secret-hidden-token</div></main>`,
      });
    else await route.abort();
  });
  const pages = [];
  for (const [url] of fixtures) {
    const page = await context.newPage();
    await page.goto(url);
    pages.push(page);
  }
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const work = tabs.filter((tab) => /github|developer.chrome|figma/.test(tab.url));
    const groupId = await chrome.tabs.group({ tabIds: work.map((tab) => tab.id) });
    await chrome.tabGroups.update(groupId, { title: 'Building', color: 'green' });
    await chrome.history.addUrl({ url: 'https://developer.mozilla.org/en-US/docs/Web/API' });
    await chrome.history.addUrl({ url: 'https://example.org/older-history-test' });
  });
  const popup = await context.newPage();
  const remotePopupRequests = [];
  popup.on('request', (request) => {
    if (/^https?:/.test(request.url())) remotePopupRequests.push(request.url());
  });
  await popup.goto(`${base}/popup.html`);
  await popup.locator('.result').first().waitFor();
  assert.equal(await popup.locator('#tabs-filter').getAttribute('aria-pressed'), 'true');
  assert.equal(await popup.locator('#history-filter').getAttribute('aria-pressed'), 'false');
  assert.equal(await popup.locator('.history-icon').count(), 0);
  const emptyHistory = await popup.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'history', query: '' }),
  );
  assert.deepEqual(emptyHistory.data, []);
  check('Search opens with tabs only and never retrieves unrelated history for an empty query');
  assert.equal(await popup.title(), 'Tab Navigator — Find your tab');
  await waitFor(
    async () => (await popup.locator('.favicon.loaded').count()) >= 4,
    'cached favicons loaded',
  );
  const cachedIcons = await popup.evaluate(async () =>
    Promise.all(
      [...document.querySelectorAll('.favicon')].map(async (image) => {
        const bytes = await (await fetch(image.src)).arrayBuffer();
        return [...new Uint8Array(bytes)].join(',');
      }),
    ),
  );
  assert(
    new Set(cachedIcons).size >= 5,
    'Results must show distinct site icons, not repeated default icons',
  );
  const iconSrc = await popup.locator('.favicon').first().getAttribute('src');
  assert(iconSrc.startsWith(`${base}/_favicon/`));
  check('Distinct website favicons load from the real Chrome cache with the renamed interface');
  await popup
    .locator('.favicon')
    .first()
    .evaluate((image) => {
      image.src = chrome.runtime.getURL('/missing-favicon-test.png');
    });
  await waitFor(
    async () => await popup.locator('.site-icon').first().locator('.icon-fallback').isVisible(),
    'failed icon fallback',
  );
  check('A failed icon restores the readable local fallback');
  const input = popup.locator('#search');
  assert.equal(await popup.locator('#domain-filter').isVisible(), false);
  await input.fill('   ');
  assert.equal(await popup.locator('#domain-filter').isVisible(), false);
  await popup.locator('#tabs-filter').click();
  await input.fill('youtube');
  await popup.getByText('Choose where to look.').waitFor();
  await popup.locator('#tabs-filter').click();
  assert.equal(await popup.locator('#tabs-filter').getAttribute('aria-pressed'), 'true');
  assert.equal(await popup.locator('#domain-filter').getAttribute('aria-pressed'), 'true');
  assert.match(await popup.locator('.domain-heading').first().textContent(), /youtube.com/);
  await popup.locator('#domain-filter').click();
  assert.equal(await popup.locator('.domain-heading').count(), 0);
  await input.fill('');
  assert.equal(await popup.locator('#domain-filter').isVisible(), false);
  await input.fill('youtube');
  assert.equal(await popup.locator('#domain-filter').isVisible(), true);
  assert.equal(await popup.locator('#domain-filter').getAttribute('aria-pressed'), 'false');
  await popup.locator('#domain-filter').click();
  assert.equal(await popup.locator('#domain-filter').getAttribute('aria-pressed'), 'true');
  check('Domain grouping can be toggled without losing the query or matches');
  assert.equal(await popup.locator('#empty').isVisible(), false);
  assert.equal(await popup.locator('#results').isVisible(), true);
  assert.equal(await popup.locator('.result-title mark').first().textContent(), 'YouTube');
  assert.equal(await popup.locator('#result-total').textContent(), '1 matching tabs');
  check('Re-enabling Tabs with YouTube already typed renders emoji titles and checks the source');
  await input.fill('chrome agents');
  await waitFor(
    async () =>
      (await popup.locator('.result-title').first().textContent())?.includes('Build extensions'),
    'search words',
  );
  check('Multi-word search ranks the matching tab first');
  await input.fill('countepress');
  await waitFor(
    async () =>
      (await popup.locator('.result-title').first().textContent())?.includes('counterpress'),
    'typo',
  );
  check('Typo-tolerant search finds the YouTube tab');
  await input.fill('building github');
  await waitFor(
    async () =>
      (await popup.locator('.result-title').first().textContent())?.includes('Source code'),
    'group and URL',
  );
  check('Tab group and URL participate in the same query');
  await popup.locator('#history-filter').click();
  await popup.evaluate(async () =>
    chrome.history.addUrl({ url: 'https://example.org/countepress' }),
  );
  await input.fill('countepress');
  await waitFor(
    async () =>
      (await popup.locator('.result-title').allTextContents()).some((text) =>
        text.includes('example.org/countepress'),
      ),
    'delayed history match',
  );
  assert((await popup.locator('.result-title').first().textContent()).includes('counterpress'));
  assert.equal(await input.getAttribute('aria-activedescendant'), 'result-0');
  check('Delayed history appends without moving the visible Enter target');
  await input.fill('');
  await input.press('ArrowDown');
  assert.equal(await input.getAttribute('aria-activedescendant'), 'result-1');
  check('Keyboard navigation updates accessible selection');
  const selectKey = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  const queryBeforeSelection = await input.inputValue();
  const activeBeforeSelection = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id,
  );
  await input.press(selectKey);
  assert.equal(await popup.locator('#selection-count').textContent(), '1 selected');
  assert.equal(await popup.locator('#refresh-order').count(), 0);
  assert.equal(await popup.locator('#result-1 .pick-tab').getAttribute('aria-checked'), 'true');
  assert.equal(await input.inputValue(), queryBeforeSelection);
  await input.press('ArrowDown');
  await input.press(selectKey);
  assert.equal(await popup.locator('#selection-count').textContent(), '2 selected');
  await input.press('ArrowUp');
  await input.press(selectKey);
  assert.equal(await popup.locator('#selection-count').textContent(), '1 selected');
  assert.equal(await popup.locator('#result-1 .pick-tab').getAttribute('aria-checked'), 'false');
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id,
    ),
    activeBeforeSelection,
  );
  assert.equal(await popup.locator('#selection-count').textContent(), '1 selected');
  check('Search order stays stable automatically without an extra control');
  await input.press('Space');
  assert.equal(await input.inputValue(), queryBeforeSelection + ' ');
  await input.fill('');
  check(
    'Command/Ctrl+Enter toggles highlighted rows without activation, while Space still searches',
  );
  await popup.locator('#tabs-filter').click();
  await popup.getByText('What are you looking for?', { exact: true }).waitFor();
  assert.equal(await popup.locator('.result').count(), 0);
  check('History-only mode waits for a query instead of listing recent browsing');
  await input.fill('older-history-test');
  await waitFor(
    async () =>
      (await popup.locator('.result-meta').allTextContents()).some((text) =>
        text.includes('older-history-test'),
      ),
    'history only',
  );
  check('History-only search retrieves a Chrome history record');
  await popup.locator('#history-filter').click();
  await popup.getByText('Choose where to look.').waitFor();
  check('Turning both sources off gives a useful empty state');
  await popup.locator('#tabs-filter').click();
  await popup.locator('#history-filter').click();
  await input.fill('zzzzzzzzzzzzzzzzzzzz');
  await popup.getByText('No matching pages.').waitFor();
  await popup.locator('#clear').click();
  assert.equal(await input.inputValue(), '');
  check('Clear search recovers from the no-match state');

  const options = await context.newPage();
  await options.goto(`${base}/options.html`);
  await options.locator('#shortcuts .settings-row').first().waitFor();
  await options.locator('#theme').selectOption('light');
  await options.getByText('Saved.', { exact: true }).waitFor();
  await popup.reload();
  await popup.locator('.result').first().waitFor();
  assert.equal(await popup.locator('#tabs-filter').getAttribute('aria-pressed'), 'true');
  assert.equal(await popup.locator('#history-filter').getAttribute('aria-pressed'), 'false');
  check('Reopening search resets the sources to tabs only');
  await popup.screenshot({
    path: join(output, 'relay-light.png'),
    clip: { x: 0, y: 0, width: 620, height: 584 },
  });
  await options.reload();
  assert.equal(await options.locator('#theme').inputValue(), 'light');
  await options.locator('#theme').selectOption('dark');
  await options.getByText('Saved.', { exact: true }).waitFor();
  const commands = await options.evaluate(async () => chrome.commands.getAll());
  const manifest = await options.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.commands['_execute_action'].suggested_key.mac, 'MacCtrl+E');
  assert.equal(manifest.commands['cycle-older'].suggested_key.mac, 'Alt+R');
  assert.equal(manifest.commands['cycle-newer'].suggested_key.mac, 'Alt+Shift+R');
  assert.equal(manifest.commands['toggle-last'].suggested_key.mac, 'Alt+Q');
  assert(commands.find((command) => command.name === '_execute_action').shortcut);
  assert(commands.find((command) => command.name === 'toggle-last').shortcut);
  for (const command of commands.filter((command) => command.name.startsWith('cycle-')))
    assert(command.shortcut);
  check('Chrome registers all four default extension shortcuts');

  // Headless key events do not reach OS/browser accelerators. Invoke the same worker
  // command dispatcher used by global shortcuts and the palette's Alt+Arrow navigation.
  const tabIds = await worker.evaluate(async () =>
    (await chrome.tabs.query({}))
      .filter((tab) => tab.url.startsWith('https://'))
      .map((tab) => tab.id),
  );
  const setActive = async (tabId) => {
    await worker.evaluate(async (id) => {
      await chrome.tabs.update(id, { active: true });
    }, tabId);
    await waitFor(
      async () =>
        await worker.evaluate(
          async (id) => (await chrome.storage.session.get('state')).state?.order[0] === id,
          tabId,
        ),
      'activation recorded',
    );
  };
  const run = async (name) => {
    const response = await options.evaluate(
      async (name) => chrome.runtime.sendMessage({ type: 'command', name }),
      name,
    );
    assert.equal(response.ok, true, response.error);
  };
  const activeId = () =>
    worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id,
    );
  await setActive(tabIds[0]);
  await setActive(tabIds[1]);
  await setActive(tabIds[2]);
  await run('toggle-last');
  assert.equal(await activeId(), tabIds[1]);
  await run('toggle-last');
  assert.equal(await activeId(), tabIds[2]);
  check('Last-tab shortcut handler toggles between two actual tabs');
  await options.evaluate(
    async (tabId) => chrome.runtime.sendMessage({ type: 'activate', tabId }),
    tabIds[2],
  );
  await setActive(tabIds[1]);
  await setActive(tabIds[2]);
  await Promise.all(Array.from({ length: 6 }, () => run('toggle-last')));
  assert.equal(await activeId(), tabIds[2]);
  check('Already-active selection and rapid repeated commands keep recency consistent');
  await setActive(tabIds[0]);
  await setActive(tabIds[1]);
  await setActive(tabIds[2]);
  const previewTarget = () =>
    worker.evaluate(async () => {
      const { preview } = await chrome.storage.session.get('preview');
      return preview?.ids[preview.index];
    });
  await run('cycle-older');
  assert.equal(await activeId(), tabIds[2]);
  assert.equal(await previewTarget(), tabIds[1]);
  await run('cycle-older');
  assert.equal(await activeId(), tabIds[2]);
  assert.equal(await previewTarget(), tabIds[0]);
  await run('cycle-newer');
  assert.equal(await activeId(), tabIds[2]);
  assert.equal(await previewTarget(), tabIds[1]);
  await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'finish-preview', commit: true }),
  );
  assert.equal(await activeId(), tabIds[1]);
  await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'finish-preview', commit: true }),
  );
  assert.equal(await activeId(), tabIds[1]);
  check('Repeated cycle and reverse commands preview a stable list and activate only on commit');

  const otherWindow = await worker.evaluate(
    async () => await chrome.windows.create({ url: 'https://example.org/other-window' }),
  );
  await worker.evaluate(async (id) => {
    await chrome.windows.update(id, { focused: true });
  }, otherWindow.id);
  await options.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'settings', settings: { currentWindow: true } }),
  );
  const before = await activeId();
  await run('toggle-last');
  assert.equal(await activeId(), before);
  await options.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'settings', settings: { currentWindow: false } }),
  );
  await run('toggle-last');
  // Headless Chrome reports both windows as focused; inspect the activated target directly.
  const destination = await options.evaluate(async () =>
    chrome.tabs.get((await chrome.storage.session.get('state')).state.order[0]),
  );
  assert.notEqual(destination.id, before);
  assert(destination.active);
  check('Window scope prevents jumping out of a single-tab window');
  await worker.evaluate(async (id) => chrome.windows.remove(id), otherWindow.id);

  const deniedContext = await options.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'settings', settings: { pageText: true } }),
  );
  assert.equal(deniedContext.data.pageText, false);
  check('Page-text indexing cannot be enabled without website permission');
  const cdp = await context.newCDPSession(options);

  // Force a real MV3 worker stop and wake it through a message from the extension page.
  const stateBefore = await worker.evaluate(
    async () => (await chrome.storage.session.get('state')).state,
  );
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  const afterWake = await options.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'snapshot' }),
  );
  assert(afterWake.ok);
  assert(afterWake.data.tabs.length >= fixtures.length);
  const stateAfter = await options.evaluate(
    async () => (await chrome.storage.session.get('state')).state,
  );
  assert.deepEqual(stateAfter.order, stateBefore.order);
  check('Real service-worker stop/wake retains tab recency and responds successfully');

  // Committing the cycle preview dismisses its popup. Open search as the user would.
  const searchPage = await context.newPage();
  await searchPage.goto(`${base}/popup.html`);
  const searchInput = searchPage.locator('#search');
  await searchInput.fill('counterpress');
  await searchPage.locator('.result-title').first().waitFor();
  await searchPage.screenshot({
    path: join(output, 'relay-search.png'),
    clip: { x: 0, y: 0, width: 620, height: 584 },
  });
  await searchInput.fill('');
  await searchPage.locator('.result').nth(3).waitFor();
  await waitFor(
    async () => (await searchPage.locator('.favicon.loaded').count()) >= 4,
    'screenshot favicons',
  );
  await searchPage.screenshot({
    path: join(output, 'relay-popup.png'),
    clip: { x: 0, y: 0, width: 620, height: 584 },
  });
  await options.reload();
  await options.locator('#shortcuts .settings-row').first().waitFor();
  await options.screenshot({ path: join(output, 'relay-settings.png'), fullPage: true });
  check('Captured screenshots of the installed extension and saved settings');
  // Enter exercises the real activation message and closes the extension page.
  await searchInput.fill('counterpress');
  const closed = searchPage.waitForEvent('close');
  await searchInput.press('Enter');
  await closed;
  const target = await options.evaluate(
    async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0],
  );
  assert.match(target.url, /youtube/);
  check('Enter switches to the matching tab and closes the palette');
  await pages[0].close();
  const snapshot = await options.evaluate(async () =>
    chrome.runtime.sendMessage({ type: 'snapshot' }),
  );
  assert(!snapshot.data.tabs.some((tab) => tab.url.includes('youtube')));
  check('Closed tabs disappear from results');
  const historyPopup = await context.newPage();
  await historyPopup.goto(`${base}/popup.html`);
  await historyPopup.locator('#history-filter').click();
  await historyPopup.locator('#tabs-filter').click();
  await historyPopup.locator('#search').fill('counterpress');
  await historyPopup.locator('.history-icon .favicon.loaded').waitFor();
  assert(
    (await historyPopup.locator('.history-icon .favicon').getAttribute('src')).includes(
      encodeURIComponent(fixtures[0][0]),
    ),
  );
  check('Closed-tab history results retain their website favicon');
  // Exercise both themes through Settings and capture only the disposable profile.
  const duplicate = await context.newPage();
  await duplicate.goto(fixtures[1][0]);
  const review = await context.newPage();
  const themePopup = await context.newPage();
  await themePopup.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['chartroom', 'midnight']) {
    await options.locator('#theme').selectOption(theme);
    await options.locator(`html[data-theme="${theme}"]`).waitFor();
    await options.reload();
    await options.locator(`html[data-theme="${theme}"]`).waitFor();
    assert.equal(await options.locator('#theme').inputValue(), theme);
    assert.equal(
      await options.getByRole('link', { name: /Open source on GitHub/ }).getAttribute('href'),
      'https://github.com/brunorsini/tab-navigator',
    );
    await options.setViewportSize({ width: 1280, height: 800 });
    await options.screenshot({ path: join(output, `settings-${theme}.png`) });
    await review.goto(`${base}/review.html`);
    await review.locator(`html[data-theme="${theme}"] .duplicate-heading`).first().waitFor();
    await review.setViewportSize({ width: 1280, height: 800 });
    await review.screenshot({ path: join(output, `duplicates-${theme}.png`) });
    await themePopup.goto(`${base}/popup.html`);
    await themePopup.locator(`html[data-theme="${theme}"] .result`).first().waitFor();
    await themePopup.locator('#search').fill('building');
    await themePopup.locator('.result').nth(2).waitFor();
    await themePopup.locator('main').screenshot({ path: join(output, `search-${theme}.png`) });
  }
  check('Both new appearance choices persist and apply to search, settings, and duplicate review');
  assert.deepEqual(remotePopupRequests, []);
  check('Searching and displaying favicons makes no remote requests from the palette');
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        browser: context.browser()?.version(),
        screenshots: ['relay-popup.png', 'relay-search.png', 'relay-settings.png'],
      },
      null,
      2,
    ),
  );
  console.log(`\n${checks.length} browser checks passed; no page errors.`);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
