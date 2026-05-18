import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
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

export async function renderMarkdown(content: string): Promise<string> {
  const result = await unified()
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
    .use(rehypePrettyCode, { theme: 'github-dark' })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(content)

  return String(result)
}
