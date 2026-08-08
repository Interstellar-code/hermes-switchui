import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The providers screen owns a scoped stylesheet. These rules are what keep it
 * from leaking into other screens and from hardcoding Matrix green in themes
 * that are not Matrix — the failure mode that made the old screen unreadable
 * (hard-coded `bg-white` slabs) in every dark theme.
 */
const CSS_PATH = 'src/styles/matrix-providers.css'

function read(relPath: string) {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8')
}

/** Comments can contain braces and colour words; nothing else needs masking. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('matrix-providers.css', () => {
  const css = read(CSS_PATH)
  const clean = stripComments(css)

  it('is one top-level block, scoped to the screen', () => {
    // Walk brace depth; every rule that opens at depth 0 must be the scope.
    let depth = 0
    const topLevelSelectors: Array<string> = []
    let buffer = ''

    for (const char of clean) {
      if (char === '{') {
        if (depth === 0) topLevelSelectors.push(buffer.trim())
        depth += 1
        buffer = ''
      } else if (char === '}') {
        depth -= 1
        buffer = ''
      } else {
        buffer += char
      }
    }

    expect(depth).toBe(0)
    expect(topLevelSelectors).toHaveLength(1)
    expect(topLevelSelectors[0]).toBe("[data-screen='providers']")
  })

  it('never paints a hard-coded light surface', () => {
    expect(clean).not.toMatch(/\bbg-white\b/)
    expect(clean).not.toMatch(/background(-color)?:\s*(#fff|#ffffff|white)\b/i)
  })

  it('expresses themeable colours as var(--m-*, var(--theme-*)) pairs', () => {
    const matrixTokens = clean.match(/var\(--m-[a-z0-9-]+/g) ?? []
    expect(matrixTokens.length).toBeGreaterThan(40)

    // Every --m-* colour token needs a --theme-* fallback so non-Matrix themes
    // resolve too. Non-colour tokens (fonts, radii, timings) may fall back to
    // a literal, since those are theme-independent.
    const colourish =
      /--m-(bg|panel|card|border|text|green|fill|stripe)[a-z0-9-]*/
    // Glows and shadows are effects, not colours — `none` is a valid fallback
    // for a theme that does not want the Matrix bloom.
    const isEffect = /--m-[a-z0-9-]*(glow|shadow)/
    const badFallbacks = (clean.match(/var\(--m-[^)]*\)/g) ?? []).filter(
      (token) =>
        colourish.test(token) &&
        !isEffect.test(token) &&
        !token.includes('var(--theme-') &&
        !token.includes('currentColor'),
    )
    expect(badFallbacks).toEqual([])
  })

  it('is wired to the screen and the portalled wizard', () => {
    const screenSource = read('src/screens/providers/providers-screen.tsx')
    expect(screenSource).toMatch(/data-screen="providers"/)
    expect(screenSource).toMatch(/@\/styles\/matrix-providers\.css/)

    // The dialog portals outside the screen subtree, so it carries its own hook.
    const wizardSource = read(
      'src/screens/providers/components/provider-wizard-dialog.tsx',
    )
    expect(wizardSource).toMatch(/data-screen="providers"/)
    expect(wizardSource).toMatch(/@\/styles\/matrix-providers\.css/)
  })
})

describe('providers screen wiring', () => {
  it('no longer references the deleted settings screen or phantom routes', () => {
    for (const relPath of [
      'src/routes/settings/providers.tsx',
      'src/screens/providers/providers-screen.tsx',
      'src/screens/providers/hooks/use-provider-mutations.ts',
    ]) {
      const source = read(relPath)
      expect(source).not.toMatch(/settings\/providers-screen/)
      expect(source).not.toMatch(/api\/config-(get|patch)/)
      expect(source).not.toMatch(/remove-provider/)
    }
  })
})
