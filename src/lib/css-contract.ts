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
 *
 * `danger|warning|info|success` are in `colourish` deliberately, not as an
 * afterthought: these are the *status* family (`--m-danger`, `--m-warning`,
 * `--m-info`, `--m-success`), declared only inside `[data-theme='matrix']`
 * in `src/styles.css`. A literal fallback here (e.g.
 * `var(--m-warning, #d6ff5f)`) is the worst-in-class version of this bug —
 * unlike a missing bg/panel/border token, which reads as visibly broken, a
 * wrong-but-plausible status colour (Matrix lime for a "warning" on a
 * near-white light theme) reads as *intentional*, so it survives review and
 * QA. That is exactly how this family fell out of `colourish` for as long as
 * it did.
 *
 * `--m-pink` is the one exception, and it is exempted explicitly rather than
 * left out of `colourish` silently (the mistake this comment exists to avoid
 * repeating). None of the ten themes define a "pink" accent — it is used as
 * a categorical marker (a 5th dot colour alongside green/amber/cyan/violet,
 * or an event-type tag like "handoff"), not a severity colour, so there is
 * no `--theme-*` token it should chain to. A literal fallback is the
 * least-bad option: it keeps the marker visible instead of collapsing to
 * `currentColor` or borrowing an unrelated theme token. `isPinkLiteral`
 * below is the visible, documented exemption; `colourish` still lists
 * `pink` so a reviewer can see it was considered, not forgotten.
 */
export function findBadMatrixFallbacks(css: string): Array<string> {
  const colourish =
    /--m-(bg|panel|card|border|text|green|fill|stripe|danger|warning|info|success|pink)[a-z0-9-]*/
  const isEffect = /--m-[a-z0-9-]*(glow|shadow)/
  const isPinkLiteral = /--m-pink[a-z0-9-]*/
  return (css.match(/var\(--m-[^)]*\)/g) ?? []).filter(
    (token) =>
      colourish.test(token) &&
      !isEffect.test(token) &&
      !isPinkLiteral.test(token) &&
      !token.includes('var(--theme-') &&
      !token.includes('currentColor'),
  )
}

/**
 * Every `--theme-*` custom property that some theme actually declares.
 *
 * Feed it `src/styles.css`. Matches declaration sites (`--theme-x: value`)
 * rather than usages, so a token that is only ever *referenced* does not
 * count itself as declared.
 */
export function declaredThemeTokens(stylesCss: string): Set<string> {
  const declared = new Set<string>()
  for (const match of stripComments(stylesCss).matchAll(
    /(--theme-[a-z0-9-]+)\s*:/g,
  )) {
    declared.add(match[1])
  }
  return declared
}

/**
 * `var(--m-*, var(--theme-X))` chains where `--theme-X` is not declared by any
 * theme, so the whole chain resolves to nothing outside Matrix.
 *
 * `findBadMatrixFallbacks` only asks whether the text `var(--theme-` appears.
 * That is a spelling check, not a correctness one, and stylesheets in this
 * repo had accumulated ~110 references to `--theme-fg`, `--theme-hover`,
 * `--theme-font-mono` and `--theme-bg-deep` — none of which exist anywhere.
 * They passed the contract while being exactly the bug it was written to
 * catch, which is the failure mode of checking shape instead of meaning.
 */
export function findUnknownThemeFallbacks(
  css: string,
  declared: Set<string>,
): Array<string> {
  const bad: Array<string> = []
  for (const match of stripComments(css).matchAll(
    /var\(\s*(--theme-[a-z0-9-]+)/g,
  )) {
    if (!declared.has(match[1])) bad.push(match[1])
  }
  return [...new Set(bad)]
}
