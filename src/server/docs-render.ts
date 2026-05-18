import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import path from 'node:path'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Element, Root } from 'hast'

/**
 * Converts fenced ```mermaid blocks into <pre class="mermaid"> elements so
 * the client-side mermaid initializer (docs-mermaid.tsx) can render them.
 * Must run before rehype-pretty-code so mermaid blocks are not syntax-highlighted.
 */
function rehypeMermaid() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (
        node.tagName !== 'pre' ||
        node.children.length !== 1 ||
        node.children[0].type !== 'element' ||
        node.children[0].tagName !== 'code'
      ) {
        return
      }
      const codeEl = node.children[0]
      const className = codeEl.properties.className as Array<string> | undefined
      if (!className?.includes('language-mermaid')) return
      const firstChild = codeEl.children[0]
      const text = firstChild.type === 'text' ? firstChild.value : ''
      node.properties = { className: ['mermaid'] }
      node.children = [{ type: 'text', value: text }]
    })
  }
}

/**
 * Rewrites relative `src` attributes on `<img>` elements to go through the
 * auth-gated `/api/docs/asset?path=` endpoint. Absolute URLs (http/https),
 * data: URIs, and root-relative /... paths that already start with / are
 * handled — see below. Leaves <pre class="mermaid"> content untouched.
 *
 * Path resolution rules:
 *  - Starts with `http://` or `https://` or `data:` → leave untouched
 *  - Starts with `/` → docs-root-relative (strip leading slash as the path param)
 *  - Otherwise → resolve relative to the current page's slug directory
 */
function rehypeRewriteDocImages(opts: { slug: string }) {
  return function (tree: Root) {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return
      const src = node.properties.src as string | undefined
      if (!src) return

      // Leave untouched: absolute URLs and data URIs
      if (
        src.startsWith('http://') ||
        src.startsWith('https://') ||
        src.startsWith('data:')
      ) {
        return
      }

      let resolvedPath: string
      if (src.startsWith('/')) {
        // Docs-root-relative: strip the leading slash
        resolvedPath = path.posix.normalize(src.slice(1))
      } else {
        // Relative to the current page's directory
        const slugDir = opts.slug.includes('/') ? path.posix.dirname(opts.slug) : '.'
        resolvedPath = path.posix.normalize(path.posix.join(slugDir, src))
      }

      // Reject traversal attempts
      if (resolvedPath.startsWith('..')) return

      node.properties.src = `/api/docs/asset?path=${encodeURIComponent(resolvedPath)}`
    })
  }
}

/**
 * Rewrites relative `.md` hrefs to internal `/docs/<slug>` paths so
 * TanStack Router can handle them client-side without a full page reload.
 * Absolute hrefs (http/https), mailto:, #-only, and already-rooted /docs/
 * paths are left untouched.
 */
function rehypeRewriteDocLinks(opts: { slug: string }) {
  return function (tree: Root) {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties.href as string | undefined
      if (!href) return

      // Leave untouched: absolute URLs, mailto, fragment-only, already-rooted /docs/
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href.startsWith('#') ||
        href.startsWith('/docs/')
      ) {
        return
      }

      // Only rewrite relative hrefs that end in .md or .md#anchor
      const mdPattern = /^([^#]+\.md)(#.*)?$/
      const match = href.match(mdPattern)
      if (!match) return

      const relPath = match[1] // e.g. "../troubleshooting/agent-connect.md"
      const fragment = match[2] ?? '' // e.g. "#section" or ""

      // Resolve relative to the current page's slug directory
      const slugDir = opts.slug.includes('/') ? path.posix.dirname(opts.slug) : '.'
      const resolved = path.posix.normalize(path.posix.join(slugDir, relPath))
      // Strip .md extension
      const slugPath = resolved.replace(/\.md$/, '')

      node.properties.href = `/docs/${slugPath}${fragment}`
    })
  }
}

export async function renderMarkdown(
  content: string,
  ctx?: { slug: string },
): Promise<string> {
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'prepend',
      properties: {
        className: ['heading-anchor'],
        ariaLabel: 'Link to this section',
      },
      content: {
        type: 'element',
        tagName: 'span',
        properties: { className: ['heading-anchor-icon'] },
        children: [{ type: 'text', value: '#' }],
      },
    })
    .use(rehypeMermaid)

  if (ctx) {
    processor = processor.use(rehypeRewriteDocLinks, ctx)
    processor = processor.use(rehypeRewriteDocImages, ctx)
  }

  const result = await processor
    .use(rehypePrettyCode, { theme: 'github-dark' })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content)

  return String(result)
}
