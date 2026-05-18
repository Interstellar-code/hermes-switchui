import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './docs-render'

describe('docs-render', () => {
  it('renders headings with slug ids and anchor', async () => {
    const html = await renderMarkdown('## Hello World\n\nbody')
    expect(html).toContain('id="hello-world"')
    expect(html).toContain('heading-anchor')
  })

  it('converts mermaid fenced block to <pre class="mermaid">', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```\n'
    const html = await renderMarkdown(md)
    expect(html).toContain('<pre class="mermaid">')
    expect(html).toContain('graph TD')
    expect(html).toContain('A-->B')
  })

  it('applies syntax highlighting to non-mermaid code blocks', async () => {
    const md = '```ts\nconst x: number = 1\n```\n'
    const html = await renderMarkdown(md)
    expect(html).toContain('data-language="ts"')
  })

  it('renders GFM tables', async () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const html = await renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
  })

  describe('rehypeRewriteDocLinks', () => {
    it('rewrites a relative .md link to /docs/ path', async () => {
      const md = '[Connect](connecting-provider.md)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="/docs/getting-started/connecting-provider"')
    })

    it('resolves nested relative paths (../foo.md) correctly', async () => {
      const md = '[Troubleshoot](../troubleshooting/agent-connect.md)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="/docs/troubleshooting/agent-connect"')
    })

    it('preserves anchor fragments when rewriting (foo.md#bar)', async () => {
      const md = '[FAQ](../faq.md#what-browsers-are-supported)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="/docs/faq#what-browsers-are-supported"')
    })

    it('leaves anchor-only links untouched (#section)', async () => {
      const md = '[Section](#section)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="#section"')
    })

    it('leaves external https:// links untouched', async () => {
      const md = '[External](https://example.com/page.md)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="https://example.com/page.md"')
    })

    it('leaves mailto: links untouched', async () => {
      const md = '[Email](mailto:hello@example.com)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="mailto:hello@example.com"')
    })

    it('leaves already-rooted /docs/ paths untouched', async () => {
      const md = '[Docs](/docs/getting-started/first-chat)'
      const html = await renderMarkdown(md, { slug: 'getting-started/first-chat' })
      expect(html).toContain('href="/docs/getting-started/first-chat"')
    })

    it('does not rewrite links when no ctx is provided', async () => {
      const md = '[Connect](connecting-provider.md)'
      const html = await renderMarkdown(md)
      expect(html).toContain('href="connecting-provider.md"')
    })

    it('handles top-level slug with sibling .md link', async () => {
      const md = '[FAQ](faq.md)'
      const html = await renderMarkdown(md, { slug: 'index' })
      expect(html).toContain('href="/docs/faq"')
    })
  })

  describe('rehypeRewriteDocImages', () => {
    it('rewrites relative image src relative to page slug directory', async () => {
      const md = '![Alt](images/foo.png)'
      const html = await renderMarkdown(md, { slug: 'getting-started/install' })
      expect(html).toContain('src="/api/docs/asset?path=getting-started%2Fimages%2Ffoo.png"')
    })

    it('rewrites docs-root-relative image (leading /)', async () => {
      const md = '![Alt](/images/foo.png)'
      const html = await renderMarkdown(md, { slug: 'getting-started/install' })
      expect(html).toContain('src="/api/docs/asset?path=images%2Ffoo.png"')
    })

    it('resolves nested relative path (../shared/diagram.svg)', async () => {
      const md = '![Diagram](../shared/diagram.svg)'
      const html = await renderMarkdown(md, { slug: 'getting-started/install' })
      expect(html).toContain('src="/api/docs/asset?path=shared%2Fdiagram.svg"')
    })

    it('leaves external https:// image src untouched', async () => {
      const md = '![External](https://example.com/img.png)'
      const html = await renderMarkdown(md, { slug: 'getting-started/install' })
      expect(html).toContain('src="https://example.com/img.png"')
    })

    it('leaves data: URI image src untouched', async () => {
      const md = '![Inline](data:image/png;base64,abc123)'
      const html = await renderMarkdown(md, { slug: 'getting-started/install' })
      expect(html).toContain('src="data:image/png;base64,abc123"')
    })

    it('does not rewrite images when no ctx is provided', async () => {
      const md = '![Alt](images/foo.png)'
      const html = await renderMarkdown(md)
      expect(html).toContain('src="images/foo.png"')
    })
  })
})
