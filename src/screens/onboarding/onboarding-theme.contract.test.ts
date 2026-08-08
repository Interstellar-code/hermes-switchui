import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findBadMatrixFallbacks,
  stripComments,
  topLevelSelectors,
} from '@/lib/css-contract'

/**
 * `matrix-onboarding.css` is the third scoped stylesheet in the repo, and the
 * first one a *screen* owns outright. The rules it has to keep are the same
 * ones `providers-theme.contract.test.ts` and `wizard-theme.contract.test.ts`
 * pin: one scoped block so `ob-*` cannot leak, no hardcoded Matrix green (the
 * ancestor this was ported from had `#00ff41` baked in), and every animation
 * neutralised under reduced motion.
 *
 * The reduced-motion check is written against how this file actually disables
 * animation — `animation: none` on the *consuming selector* rather than a
 * repeat of the keyframe name — so it stays a real check instead of a string
 * search that any mention of the name would satisfy.
 */
const CSS_PATH = 'src/styles/matrix-onboarding.css'
const SCREEN_PATH = 'src/screens/onboarding/onboarding-screen.tsx'

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

/** The selector whose declaration block actually runs `name`. */
function selectorConsuming(source: string, name: string): string | null {
  const match = new RegExp(
    `animation(?:-name)?:[^;}]*\\b${name}\\b[^;}]*`,
  ).exec(source)
  if (!match) return null

  const open = source.lastIndexOf('{', match.index)
  if (open < 0) return null
  const boundary = Math.max(
    source.lastIndexOf('{', open - 1),
    source.lastIndexOf('}', open - 1),
    source.lastIndexOf(';', open - 1),
  )
  return source.slice(boundary + 1, open).trim()
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('matrix-onboarding.css', () => {
  it('is one top-level style rule, scoped to the onboarding screen', () => {
    const selectors = topLevelSelectors(clean)
    // `@keyframes` cannot legally nest inside a style rule, so at-rules are
    // allowed at the top level; nothing that matches elements may be.
    const styleRules = selectors.filter((selector) => !selector.startsWith('@'))
    const atRules = selectors.filter((selector) => selector.startsWith('@'))

    expect(styleRules).toHaveLength(1)
    expect(styleRules[0]).toBe("[data-screen='onboarding']")
    expect(atRules.every((rule) => rule.startsWith('@keyframes'))).toBe(true)
  })

  it('never paints a hard-coded light surface', () => {
    expect(clean).not.toMatch(/\bbg-white\b/)
    expect(clean).not.toMatch(/background(-color)?:\s*(#fff|#ffffff|white)\b/i)
  })

  it('carries no literal Matrix green', () => {
    expect(clean).not.toMatch(/#00ff41/i)
    expect(clean).not.toMatch(/rgba\(\s*0\s*,\s*255\s*,\s*65/)
  })

  it('expresses themeable colours as var(--m-*, var(--theme-*)) pairs', () => {
    expect(findBadMatrixFallbacks(clean)).toEqual([])
  })

  it('neutralises every keyframe it declares under reduced motion', () => {
    const reduced = blockAfter(clean, '@media (prefers-reduced-motion: reduce)')
    expect(reduced).not.toBe('')

    const names = [...clean.matchAll(/@keyframes\s+([\w-]+)/g)].map(
      (match) => match[1],
    )
    expect(names.length).toBeGreaterThan(0)

    for (const name of names) {
      const selector = selectorConsuming(clean, name)
      expect(selector, `nothing consumes @keyframes ${name}`).not.toBeNull()

      // The consuming selector must reappear inside the reduced-motion block
      // with its animation switched off.
      const disabled = new RegExp(
        `${escapeForRegExp(selector as string)}\\s*\\{[^}]*animation:\\s*none`,
      )
      expect(
        disabled.test(reduced),
        `${selector} still animates under reduced motion`,
      ).toBe(true)
    }
  })
})

describe('the onboarding screen owns the stylesheet', () => {
  const source = readFileSync(resolve(process.cwd(), SCREEN_PATH), 'utf8')

  it('scopes the wizard shell to [data-screen="onboarding"]', () => {
    // `WizardShell` turns `screen` into the `data-screen` attribute the
    // stylesheet is keyed on; without it every `ob-*` rule is inert.
    expect(source).toMatch(/screen="onboarding"/)
  })

  it('imports the stylesheet from the screen root only', () => {
    expect(source).toMatch(/import '@\/styles\/matrix-onboarding\.css'/)

    const importers = [
      'src/screens/onboarding/steps/welcome-step.tsx',
      'src/screens/onboarding/steps/summary-step.tsx',
      'src/screens/onboarding/steps/finish-step.tsx',
      'src/screens/onboarding/components/onboarding-checklist.tsx',
    ].filter((relPath) =>
      /matrix-onboarding\.css/.test(
        readFileSync(resolve(process.cwd(), relPath), 'utf8'),
      ),
    )
    expect(importers).toEqual([])
  })
})

describe('the replaced wizards stay deleted', () => {
  it('leaves no copy of the surfaces this flow replaced', () => {
    const survivors = [
      // Phase 0.
      'src/components/onboarding/index.ts',
      'src/components/onboarding/onboarding-steps.ts',
      'src/components/onboarding/onboarding-tour.tsx',
      'src/components/onboarding/onboarding-tour.test.ts',
      'src/components/onboarding/onboarding-wizard.tsx',
      'src/components/onboarding/provider-select-step.tsx',
      'src/components/onboarding/setup-step-content.tsx',
      'src/components/onboarding/tour-steps.tsx',
      'src/hooks/use-onboarding.ts',
      // The wizard this screen replaces.
      'src/components/onboarding/claude-onboarding.tsx',
      'src/components/onboarding/claude-onboarding.relaunch.test.tsx',
    ].filter((relPath) => existsSync(resolve(process.cwd(), relPath)))

    expect(survivors).toEqual([])
  })
})
