import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(websiteRoot, '..');
const docsRoot = path.join(repoRoot, 'docs');
const publicRoot = path.join(websiteRoot, 'public', 'docs-assets');

const assetDirs = ['diagrams', 'images', 'screenshots'];

fs.rmSync(publicRoot, { recursive: true, force: true });
fs.mkdirSync(publicRoot, { recursive: true });

for (const dir of assetDirs) {
  const from = path.join(docsRoot, dir);
  const to = path.join(publicRoot, dir);
  if (fs.existsSync(from)) {
    fs.cpSync(from, to, { recursive: true });
    console.log(`synced ${path.relative(repoRoot, from)} -> ${path.relative(repoRoot, to)}`);
  }
}
