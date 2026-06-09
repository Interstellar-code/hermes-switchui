import path from 'node:path';
import { visit } from 'unist-util-visit';

const DOCS_ROOT = path.resolve(process.cwd(), '..', 'docs');
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const DOCS_BASE = `${BASE}/docs`;
const ASSET_BASE = `${BASE}/docs-assets`;
const DOC_EXT_RE = /\.(markdown|mdown|mkdn|mkd|mdwn|md|mdx)$/i;

function textContent(node) {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(textContent).join('');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function normalizeSlug(relativeFilePath) {
  return relativeFilePath
    .replace(DOC_EXT_RE, '')
    .replace(/\/index$/i, '')
    .replace(/^\.\//, '');
}

function currentSlug(file) {
  const filePath = file?.path;
  if (!filePath) return '';
  const rel = toPosix(path.relative(DOCS_ROOT, filePath));
  return normalizeSlug(rel);
}

function docsHrefFromMarkdownLink(slug, href) {
  const [target, fragment = ''] = href.split('#');
  const baseDir = slug.includes('/') ? path.posix.dirname(slug) : '.';
  const resolved = path.posix.normalize(path.posix.join(baseDir, target));
  if (resolved.startsWith('..')) return null;
  const nextSlug = normalizeSlug(resolved);
  const suffix = fragment ? `#${fragment}` : '';
  return `${DOCS_BASE}/${nextSlug}/`.replace(/\/+/g, '/').replace(/(?<!:)\/\//g, '/') + suffix;
}

function assetHrefFromPath(slug, source) {
  if (!source) return null;
  if (/^(https?:|data:)/i.test(source)) return source;

  let resolved;
  if (source.startsWith('/api/docs-asset?path=') || source.startsWith('/api/docs/asset?path=')) {
    const url = new URL(source, 'https://example.com');
    const assetPath = url.searchParams.get('path');
    if (!assetPath) return null;
    resolved = path.posix.normalize(assetPath);
  } else if (source.startsWith('/')) {
    resolved = path.posix.normalize(source.slice(1));
  } else {
    const baseDir = slug.includes('/') ? path.posix.dirname(slug) : '.';
    resolved = path.posix.normalize(path.posix.join(baseDir, source));
  }

  if (resolved.startsWith('..')) return null;
  return `${ASSET_BASE}/${resolved}`;
}

export function rehypeRewriteDocsLinksAndAssets() {
  return (tree, file) => {
    const slug = currentSlug(file);
    visit(tree, 'raw', (node) => {
      if (typeof node.value !== 'string' || !node.value.includes('<iframe')) return;
      node.value = node.value.replace(/<iframe\b([^>]*)>/gi, (match, attrs) => {
        const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
        if (!srcMatch) return match;
        const rewritten = assetHrefFromPath(slug, srcMatch[1]);
        if (!rewritten) return match;
        let next = match.replace(srcMatch[1], rewritten);
        if (!/\bsandbox=/i.test(next)) next = next.replace('<iframe', '<iframe sandbox=""');
        if (!/\breferrerpolicy=/i.test(next)) {
          next = next.replace('<iframe', '<iframe referrerpolicy="no-referrer"');
        }
        return next;
      });
    });

    visit(tree, 'element', (node) => {
      if (node.tagName === 'pre') {
        const code = node.children?.find?.((child) => child.type === 'element' && child.tagName === 'code');
        const className = code?.properties?.className;
        const classes = Array.isArray(className) ? className : typeof className === 'string' ? className.split(/\s+/) : [];
        if (classes.includes('language-mermaid')) {
          node.tagName = 'div';
          node.properties = {
            className: ['mermaid', 'docs-mermaid'],
            'data-mermaid-source': 'true',
          };
          node.children = [{ type: 'text', value: textContent(code).trim() }];
          return;
        }
      }

      if (node.tagName === 'a') {
        const href = node.properties?.href;
        if (typeof href === 'string') {
          if (!/^(https?:|mailto:|#|\/docs\/)/i.test(href) && /\.mdx?(#.*)?$/i.test(href)) {
            const rewritten = docsHrefFromMarkdownLink(slug, href);
            if (rewritten) node.properties.href = rewritten;
          }
        }
      }

      if (node.tagName === 'img' || node.tagName === 'iframe') {
        const src = node.properties?.src;
        if (typeof src === 'string') {
          const rewritten = assetHrefFromPath(slug, src);
          if (rewritten) node.properties.src = rewritten;
        }
        if (node.tagName === 'iframe') {
          node.properties.sandbox = '';
          node.properties.referrerpolicy = 'no-referrer';
        }
      }
    });
  };
}
