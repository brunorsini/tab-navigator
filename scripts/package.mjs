import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkRelease, root, extension } from './check-release.mjs';

const { manifest, files } = await checkRelease();
await mkdir(join(root, 'dist'), { recursive: true });
const destination = join(root, 'dist', `tab-navigator-${manifest.version}.zip`);
// Build a fresh archive from the reviewed allowlist. -X strips platform metadata.
await rm(destination, { force: true });
execFileSync('zip', ['-q', '-X', destination, ...files], { cwd: extension });
execFileSync('unzip', ['-t', destination], { stdio: 'pipe' });
const digest = createHash('sha256')
  .update(await readFile(destination))
  .digest('hex');
await writeFile(`${destination}.sha256`, `${digest}  ${basename(destination)}\n`);
console.log(`Packaged ${files.length} files: dist/${basename(destination)}`);
console.log(`SHA-256: ${digest}`);
