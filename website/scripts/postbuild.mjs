// Postbuild: rewrite absolute-rooted asset hrefs to relative so the static
// build serves correctly under any base path. Replaces the previous
// macOS-only `sed -i ''` step with a cross-platform Node equivalent.
//
// When SITE_BASE is set (e.g. /website), Astro already emits correct absolute
// paths like /website/_astro/... — skip the rewrite in that case.
import { readFileSync, writeFileSync } from 'node:fs';

const siteBase = process.env.SITE_BASE;
if (siteBase && siteBase !== '/') {
  console.log(`postbuild: SITE_BASE=${siteBase} — skipping index.html path rewrite (absolute paths are already correct).`);
} else {
  const file = 'dist/index.html';
  const html = readFileSync(file, 'utf8');
  const fixed = html.replaceAll('href="/./_astro/', 'href="./_astro/');
  writeFileSync(file, fixed);
  console.log(`postbuild: normalized asset paths in ${file}`);
}
