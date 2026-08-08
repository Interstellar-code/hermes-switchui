/**
 * css-contract.ts — pure helpers for stylesheet contract tests.
 *
 * These were inlined in `src/screens/providers/providers-theme.contract.test.ts`
 * until a second scoped stylesheet (`src/components/wizard/wizard.css`) needed
 * the same three checks. They are deliberately regex/string based: parsing CSS
 * properly would accept things the contract exists to reject (a nested
 * `@supports` block that reintroduces a top-level selector, for instance).
 */

/** Comments can contain braces and colour words; nothing else needs masking. */
export function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * Every selector that opens a block at brace depth 0. Feed it comment-stripped
 * CSS — a `{` inside a comment would desync the walker.
 */
export function topLevelSelectors(css: string): Array<string> {
  let depth = 0
  const selectors: Array<string> = []
  let buffer = ''

  for (const char of css) {
    if (char === '{') {
      if (depth === 0) selectors.push(buffer.trim())
      depth += 1
      buffer = ''
    } else if (char === '}') {
      depth -= 1
      buffer = ''
    } else {
      buffer += char
    }
  }

  return selectors
}

/**
 * `var(--m-*)` references to a *colour* token that have no `var(--theme-*)`
 * fallback, so they resolve to nothing outside the Matrix theme.
 *
 * Non-colour tokens (fonts, radii, timings) may fall back to a literal, since
 * those are theme-independent. Glows and shadows are effects, not colours —
 * `none` is a valid fallback for a theme that does not want the Matrix bloom.
 * `currentColor` is always allowed: it inherits whatever the theme resolved.
 */
export function findBadMatrixFallbacks(css: string): Array<string> {
  const colourish =
    /--m-(bg|panel|card|border|text|green|fill|stripe)[a-z0-9-]*/
  const isEffect = /--m-[a-z0-9-]*(glow|shadow)/
  return (css.match(/var\(--m-[^)]*\)/g) ?? []).filter(
    (token) =>
      colourish.test(token) &&
      !isEffect.test(token) &&
      !token.includes('var(--theme-') &&
      !token.includes('currentColor'),
  )
}
