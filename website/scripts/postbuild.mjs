// Postbuild: rewrite absolute-rooted asset hrefs to relative so the static
// build serves correctly under any base path. Replaces the previous
// macOS-only `sed -i ''` step with a cross-platform Node equivalent.
import { readFileSync, writeFileSync } from 'node:fs';

const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
const fixed = html.replaceAll('href="/./_astro/', 'href="./_astro/');
writeFileSync(file, fixed);

console.log(`postbuild: normalized asset paths in ${file}`);
