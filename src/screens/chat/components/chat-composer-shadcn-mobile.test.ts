import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () =>
  readFileSync(
    resolve(process.cwd(), 'src/screens/chat/components/chat-composer-shadcn.tsx'),
    'utf8',
  )

describe('ChatComposerShadcn mobile docking contract', () => {
  it('docks only the non-embedded mobile composer and restores inline layout at md', () => {
    const src = source()

    expect(src).toContain('embedded = false')
    expect(src).toContain('bottom-[var(--kb-inset,0px)]')
    expect(src).toContain('md:static')
    expect(src).toContain("? 'pb-6 md:pb-8'")
  })

  it('reports composer focus to the mobile workspace state', () => {
    const src = source()

    expect(src).toContain('setMobileComposerFocused(true)')
    expect(src).toContain('setMobileComposerFocused(false)')
  })
})
