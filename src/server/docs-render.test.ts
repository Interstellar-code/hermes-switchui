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
})
