import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  LOCAL_COMMAND_HANDLERS,
} from '@/screens/chat/hooks/use-slash-commands'

/**
 * MCP must stay reachable from every navigation surface.
 *
 * `slash-command-menu.tsx` used to be in this list, but the slash picker has
 * not advertised `/mcp` since §8a of
 * `docs/plans/hermes-slash-commands-in-switchui.md` — the sidebar and the ⌘K
 * palette already navigate there. This check was only passing on a backtick
 * inside that file's doc comment, so it was asserting nothing.
 *
 * The real slash-side invariant is the one below: `/mcp` still *routes*, which
 * is what keeps it from being handed to the model as prose.
 */
const FILES = [
  'src/components/command-palette.tsx',
  'src/components/mobile-hamburger-menu.tsx',
  'src/components/mobile-tab-bar.tsx',
  'src/components/search/search-modal.tsx',
  'src/components/workspace-shell.tsx',
] as const

describe('MCP nav registration', () => {
  for (const relPath of FILES) {
    it(`${relPath} registers an MCP entry`, () => {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf8')
      expect(/['"`]\/mcp['"`]/.test(source)).toBe(true)
    })
  }

  it('the slash router still handles /mcp, even though the picker hides it', () => {
    expect(LOCAL_COMMAND_HANDLERS).toContain('/mcp')
  })
})
