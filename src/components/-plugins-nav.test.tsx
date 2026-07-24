import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILES = [
  'src/components/command-palette.tsx',
  'src/components/mobile-hamburger-menu.tsx',
  'src/components/mobile-tab-bar.tsx',
  'src/components/search/search-modal.tsx',
  'src/components/workspace-shell.tsx',
  'src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx',
  'src/screens/chat/hooks/use-slash-commands.ts',
] as const

describe('Plugins nav registration', () => {
  for (const relPath of FILES) {
    it(`${relPath} registers a Plugins entry`, () => {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf8')
      expect(/['"`]\/plugins['"`]/.test(source)).toBe(true)
    })
  }

  it('renders the shared Plugins Hub count in the primary sidebar', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/screens/chat/components/sidebar/v2/primary-nav-v2.tsx',
      ),
      'utf8',
    )
    expect(source).toMatch(/label="Plugins"[\s\S]*?badge=\{counts\.plugins\}/)
  })
})
