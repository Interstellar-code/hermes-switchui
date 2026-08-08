import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findBadMatrixFallbacks,
  stripComments,
  topLevelSelectors,
} from '@/lib/css-contract'

/**
 * The wizard shell is shared chrome, so its stylesheet is the one most likely
 * to leak: a single unscoped `.wz-btn` would repaint buttons on every screen
 * that happens to reuse the class name. These rules keep it sealed inside
 * `[data-wizard]` and keep its colours resolvable in all ten themes — the
 * ancestor block in matrix-profiles.css hardcoded `#00ff41`, which is exactly
 * the bug this file exists to prevent from being copied forward.
 */
const CSS_PATH = 'src/components/wizard/wizard.css'

const css = readFileSync(resolve(process.cwd(), CSS_PATH), 'utf8')
const clean = stripComments(css)

/** Slice out a nested at-rule by balancing braces from its prelude. */
function blockAfter(source: string, prelude: string): string {
  const start = source.indexOf(prelude)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return ''
}

describe('wizard.css', () => {
  it('is one top-level block, scoped to [data-wizard]', () => {
    const selectors = topLevelSelectors(clean)
    // @keyframes cannot legally be nested inside a style rule, so at-rules are
    // allowed at the top level; nothing that matches elements may be.
    const styleRules = selectors.filter((s) => !s.startsWith('@'))
    const atRules = selectors.filter((s) => s.startsWith('@'))

    expect(styleRules).toHaveLength(1)
    expect(styleRules[0]).toBe('[data-wizard]')
    expect(atRules.every((rule) => rule.startsWith('@keyframes'))).toBe(true)
  })

  it('never paints a hard-coded light surface', () => {
    expect(clean).not.toMatch(/\bbg-white\b/)
    expect(clean).not.toMatch(/background(-color)?:\s*(#fff|#ffffff|white)\b/i)
  })

  it('carries no literal Matrix green', () => {
    // The ancestor `.wiz-modal` hardcoded both of these; re-tokenising them is
    // the whole point of the port.
    expect(clean).not.toMatch(/#00ff41/i)
    expect(clean).not.toMatch(/rgba\(\s*0\s*,\s*255\s*,\s*65/)
  })

  it('expresses themeable colours as var(--m-*, var(--theme-*)) pairs', () => {
    const matrixTokens = clean.match(/var\(--m-[a-z0-9-]+/g) ?? []
    expect(matrixTokens.length).toBeGreaterThan(40)
    expect(findBadMatrixFallbacks(clean)).toEqual([])
  })

  it('neutralises every animation it declares under reduced motion', () => {
    const reduced = blockAfter(clean, '@media (prefers-reduced-motion: reduce)')
    expect(reduced).not.toBe('')

    const names = new Set(
      Array.from(clean.matchAll(/animation(?:-name)?:\s*([a-zA-Z_-][\w-]*)/g))
        .map((match) => match[1])
        .filter(
          (name) => !['none', 'inherit', 'initial', 'unset'].includes(name),
        ),
    )
    expect(names.size).toBeGreaterThan(0)
    for (const name of names) {
      expect(reduced).toContain(name)
    }

    // Transitions are killed wholesale rather than per-rule.
    expect(reduced).toMatch(/transition-duration:\s*[\d.]+m?s\s*!important/)
    expect(reduced).toMatch(/animation-duration:\s*[\d.]+m?s\s*!important/)
  })
})
