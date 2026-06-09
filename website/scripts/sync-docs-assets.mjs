import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(here, '..');
const repoRoot = path.resolve(websiteRoot, '..');
const docsRoot = path.join(repoRoot, 'docs');
const publicRoot = path.join(websiteRoot, 'public', 'docs-assets');
const vendorRoot = path.join(websiteRoot, 'public', 'vendor', 'mermaid');

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

const mermaidDist = path.join(websiteRoot, 'node_modules', 'mermaid', 'dist');
const mermaidEntry = path.join(mermaidDist, 'mermaid.esm.min.mjs');
if (fs.existsSync(mermaidEntry)) {
  fs.rmSync(vendorRoot, { recursive: true, force: true });
  fs.mkdirSync(vendorRoot, { recursive: true });
  fs.cpSync(mermaidDist, vendorRoot, { recursive: true });
  console.log(`synced mermaid runtime -> ${path.relative(repoRoot, vendorRoot)}`);
} else {
  throw new Error(`Missing Mermaid runtime at ${path.relative(repoRoot, mermaidEntry)}`);
}
