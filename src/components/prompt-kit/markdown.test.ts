import { describe, expect, it } from 'vitest'

import { MARKDOWN_REMARK_PLUGINS } from './markdown'

describe('Markdown plugin pipeline', () => {
  it('wires remark-gfm into the markdown parser pipeline', () => {
    expect(
      MARKDOWN_REMARK_PLUGINS.some((plugin) => plugin.name === 'remarkGfm'),
    ).toBe(true)
  })

  it('wires remark-breaks into the markdown parser pipeline', () => {
    expect(
      MARKDOWN_REMARK_PLUGINS.some((plugin) => plugin.name === 'remarkBreaks'),
    ).toBe(true)
  })
})
