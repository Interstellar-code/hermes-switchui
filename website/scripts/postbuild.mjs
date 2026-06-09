import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const siteBase = process.env.SITE_BASE;
const here = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(here, '..');
const distRoot = path.join(websiteRoot, 'dist');
const docsDistRoot = path.join(distRoot, 'docs');
const pagefindOut = path.join(distRoot, 'pagefind');
const normalizedBase = siteBase && siteBase !== '/' ? siteBase.replace(/\/$/, '') : '';
const docsPrefix = `${normalizedBase}/docs`;
const docsAssetsPrefix = `${normalizedBase}/docs-assets`;

function walkFiles(dir, predicate) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, predicate));
    else if (entry.isFile() && predicate(full)) files.push(full);
  }
  return files;
}

function walkHtml(dir) {
  return walkFiles(dir, (full) => full.endsWith('.html'));
}

function slugFromHtmlFile(file) {
  const rel = path.relative(docsDistRoot, file).split(path.sep).join('/');
  if (rel === 'index.html') return 'welcome';
  return rel.replace(/\/index\.html$/, '').replace(/\.html$/, '');
}

function docsHrefFromMarkdownLink(slug, href) {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  const [target, fragment = ''] = href.split('#');
  const baseDir = slug.includes('/') ? path.posix.dirname(slug) : '.';
  const resolved = path.posix.normalize(path.posix.join(baseDir, target));
  if (resolved.startsWith('..')) return href;
  const nextSlug = resolved.replace(/\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/i, '').replace(/\/index$/i, '');
  return `${docsPrefix}/${nextSlug}/${fragment ? `#${fragment}` : ''}`.replace('/#', '#');
}

function decodeHtmlAttribute(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\u007f/g, '\n');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rewriteMermaidBlocks(html) {
  return html.replace(
    /<div class="expressive-code">\s*<figure\b(?=[\s\S]*?<pre data-language="mermaid")[\s\S]*?\bdata-code="([^"]+)"[\s\S]*?<\/figure>\s*<\/div>/g,
    (_match, encodedCode) => {
      const code = decodeHtmlAttribute(encodedCode).trim();
      return `<div class="mermaid docs-mermaid" data-mermaid-source="true">${escapeHtml(code)}</div>`;
    }
  );
}

function rewriteDocsHtml(file) {
  const slug = slugFromHtmlFile(file);
  let html = fs.readFileSync(file, 'utf8');

  html = rewriteMermaidBlocks(html);

  html = html.replace(/<iframe\b([^>]*)src=["']\/api\/docs(?:-asset|\/asset)\?path=([^"']+)["']([^>]*)>/gi, (_m, before, rawPath, after) => {
    const assetPath = decodeURIComponent(rawPath);
    const sandbox = /\bsandbox=/i.test(`${before} ${after}`) ? '' : ' sandbox=""';
    const referrer = /\breferrerpolicy=/i.test(`${before} ${after}`) ? '' : ' referrerpolicy="no-referrer"';
    return `<iframe${before}src="${docsAssetsPrefix}/${assetPath}"${after}${sandbox}${referrer}>`;
  });

  html = html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (_m, start, src, end) => {
    const docsAssetsPattern = new RegExp(`^${docsAssetsPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'i');
    if (/^(https?:|data:)/i.test(src) || docsAssetsPattern.test(src)) return `${start}${src}${end}`;
    const baseDir = slug.includes('/') ? path.posix.dirname(slug) : '.';
    const resolved = src.startsWith('/')
      ? path.posix.normalize(src.slice(1))
      : path.posix.normalize(path.posix.join(baseDir, src));
    if (resolved.startsWith('..')) return `${start}${src}${end}`;
    return `${start}${docsAssetsPrefix}/${resolved}${end}`;
  });

  html = html.replace(/(<a\b[^>]*\bhref=["'])([^"']+\.md(?:#[^"']*)?)(["'][^>]*>)/gi, (_m, start, href, end) => {
    return `${start}${docsHrefFromMarkdownLink(slug, href)}${end}`;
  });

  if (normalizedBase) {
    html = html.replaceAll('href="/docs/', `href="${docsPrefix}/`);
    html = html.replaceAll('src="/docs-assets/', `src="${docsAssetsPrefix}/`);
  }

  fs.writeFileSync(file, html);
}

function removeDuplicateRootDocs() {
  const docsHtml = walkHtml(docsDistRoot);
  const removed = [];
  for (const file of docsHtml) {
    const rel = path.relative(docsDistRoot, file);
    if (rel === 'index.html') continue;
    const duplicate = path.join(distRoot, rel);
    if (fs.existsSync(duplicate)) {
      fs.rmSync(duplicate, { force: true });
      removed.push(duplicate);
      let dir = path.dirname(duplicate);
      while (dir.startsWith(distRoot) && dir !== distRoot) {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      }
    }
  }
  return removed.map((file) => '/' + path.relative(distRoot, file).replace(/\\/g, '/').replace(/\/index\.html$/, '/'));
}

function rewriteSitemaps(removedPaths) {
  if (removedPaths.length === 0) return;
  const removed = new Set(removedPaths.map((p) => p.replace(/\/$/, '') || '/'));
  const xmlFiles = walkFiles(distRoot, (full) => full.endsWith('.xml'));
  for (const file of xmlFiles) {
    let xml = fs.readFileSync(file, 'utf8');
    xml = xml.replace(/<url>([\s\S]*?)<\/url>/g, (block) => {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      if (!loc) return block;
      const pathname = new URL(loc).pathname.replace(/\/$/, '') || '/';
      return removed.has(pathname) ? '' : block;
    });
    fs.writeFileSync(file, xml);
  }
}

function rebuildPagefind() {
  const bin = path.join(websiteRoot, 'node_modules', '.bin', 'pagefind');
  fs.rmSync(pagefindOut, { recursive: true, force: true });
  execFileSync(bin, ['--site', 'dist'], {
    cwd: websiteRoot,
    stdio: 'inherit',
  });
}

if (siteBase && siteBase !== '/') {
  console.log(`postbuild: SITE_BASE=${siteBase} — skipping landing-page asset normalization`);
} else {
  const file = path.join(distRoot, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const fixed = html.replaceAll('href="/./_astro/', 'href="./_astro/');
  fs.writeFileSync(file, fixed);
  console.log(`postbuild: normalized asset paths in ${path.relative(websiteRoot, file)}`);
}

if (fs.existsSync(docsDistRoot)) {
  for (const file of walkHtml(docsDistRoot)) {
    rewriteDocsHtml(file);
  }
  console.log(`postbuild: rewrote generated /docs HTML under ${path.relative(websiteRoot, docsDistRoot)}`);
  const removedPaths = removeDuplicateRootDocs();
  if (removedPaths.length > 0) {
    console.log(`postbuild: removed ${removedPaths.length} duplicate root doc routes`);
    rewriteSitemaps(removedPaths);
    rebuildPagefind();
  }
}
