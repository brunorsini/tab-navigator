import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = resolve(import.meta.dirname, '..');
export const extension = join(root, 'extension');
const json = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));

async function listFiles(directory) {
  const files = [];
  for (const name of await readdir(directory)) {
    if (name === '.DS_Store') continue;
    const path = join(directory, name);
    const info = await lstat(path);
    assert(!info.isSymbolicLink(), `Release must not include symlinks: ${relative(root, path)}`);
    if (info.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(relative(extension, path));
  }
  return files.sort();
}

function checkPng(bytes, label) {
  assert(
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    `Invalid PNG: ${label}`,
  );
  // Pixel data and color interpretation only: no EXIF, comments, or provenance payloads.
  const allowed = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'cHRM', 'iCCP']);
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length && !ended) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    assert(allowed.has(type), `Unexpected PNG metadata ${type}: ${label}`);
    offset += length + 12;
    assert(offset <= bytes.length, `Truncated PNG: ${label}`);
    ended = type === 'IEND';
  }
  assert(ended && offset === bytes.length, `Unexpected trailing PNG data: ${label}`);
}

export async function checkRelease() {
  const [manifest, pkg, lock, files] = await Promise.all([
    json('extension/manifest.json'),
    json('package.json'),
    json('package-lock.json'),
    json('scripts/release-files.json'),
  ]);
  assert.deepEqual(
    await listFiles(extension),
    files,
    'Review and update the explicit release file list before packaging.',
  );
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.incognito, 'not_allowed');
  assert(
    !manifest.key && !manifest.oauth2 && !manifest.externally_connectable && !manifest.update_url,
  );
  assert(
    !manifest.host_permissions && !manifest.content_scripts,
    'Website access must remain optional.',
  );
  assert.deepEqual(manifest.permissions, [
    'tabs',
    'tabGroups',
    'storage',
    'history',
    'scripting',
    'favicon',
  ]);
  assert.deepEqual(manifest.optional_permissions, ['bookmarks']);
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
  assert(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"));
  assert(manifest.content_security_policy.extension_pages.includes("script-src 'self'"));
  assert.equal(manifest.action.default_popup, `popup.html?ui=${manifest.version}`);
  assert.equal(
    await readFile(join(extension, 'LICENSE'), 'utf8'),
    await readFile(join(root, 'LICENSE'), 'utf8'),
  );

  for (const file of files) {
    const path = join(extension, file);
    const bytes = await readFile(path);
    if (file.endsWith('.png')) {
      checkPng(bytes, file);
      continue;
    }
    const text = bytes.toString('utf8');
    assert(!/\/(?:Users|home)\/[^/\s]+\/|\/var\/folders\//.test(text), `Local path in ${file}`);
    assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `Private key in ${file}`);
    if (file.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
      assert(
        !/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|eval)\s*\(|\bnew\s+Function\s*\(/.test(
          text,
        ),
        `Review network/dynamic-code use in ${file}`,
      );
      assert(
        !/\.innerHTML\s*=|\.outerHTML\s*=|\.insertAdjacentHTML\s*\(/.test(text),
        `Review HTML insertion in ${file}`,
      );
    }
    if (file.endsWith('.html')) {
      assert(
        !/\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(text),
        `External resource in ${file}`,
      );
      for (const [, reference] of text.matchAll(/\b(?:src|href)="([^"#]+)"/g)) {
        assert(files.includes(reference.split('?')[0]), `Missing HTML resource: ${reference}`);
      }
    }
  }
  for (const file of ['assets/schnauzer-sailor.png', 'assets/spyglass-toolbar.png']) {
    checkPng(await readFile(join(root, file)), file);
  }
  const vendored = await readFile(join(extension, 'vendor/tldts.js'), 'utf8');
  const dependency = await readFile(join(root, 'node_modules/tldts/dist/index.esm.min.js'), 'utf8');
  assert.equal(
    vendored,
    dependency.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'),
    'Vendored parser differs from the pinned dependency.',
  );
  console.log(
    `Release checks passed: v${manifest.version}, ${files.length} explicitly allowed files.`,
  );
  return { manifest, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkRelease();
