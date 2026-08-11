import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stripComments, topLevelSelectors } from '@/lib/css-contract'

/**
 * Guards against the exact bug Stream 3A of plan immutable-noodling-koala
 * shipped to fix: `.text-input` (12 uses), `.select-input` (8), `.input-sm`
 * (3), `.btn-sm`, `.pill-ok`/`.pill-warn` and `.mini-table-wrap` were
 * referenced throughout `sections/*.tsx` but defined in NO stylesheet, so
 * they rendered as bare unstyled elements. `.btn-primary`/`.btn-danger`
 * (hyphenated, written at 27+ call sites) only rendered correctly because a
 * *different* screen's stylesheet (`matrix-crons.css` / `matrix-profiles.css`
 * / `matrix-tasks.css`) happened to already be loaded in the same SPA
 * session — landing on `/settings` cold in a fresh tab left them unstyled.
 *
 * This sweeps every class referenced from a `className=` attribute in every
 * `section-*.tsx` file and asserts `matrix-settings.css` defines a selector
 * for it, the same way `matrix-theme-tokens.contract.test.ts` sweeps
 * `var(--m-*)` fallbacks: file list discovered at test-run time (not
 * hand-maintained), one `it.each` per file so a failure names the offending
 * file directly, plus a canary so a broken discovery glob fails loud instead
 * of silently checking zero files.
 */
const ROOT = process.cwd()
const CSS_PATH = resolve(ROOT, 'src/styles/matrix-settings.css')
const SECTIONS_DIR = resolve(ROOT, 'src/screens/settings/sections')

/**
 * Every class name `matrix-settings.css` defines a selector for — i.e. every
 * `.foo` token in a top-level selector, at any nesting (`.btn.btn-primary`,
 * `.row .lbl .pill`, `input.input-sm`, …).
 */
function definedClasses(css: string): Set<string> {
  const classes = new Set<string>()
  for (const selector of topLevelSelectors(css)) {
    for (const match of selector.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
      classes.add(match[1])
    }
  }
  return classes
}

/**
 * The raw text following `className=` in a JSX file: either a plain
 * `"..."` string, or a `{...}` expression. Braces are counted rather than
 * matched with a fixed-depth regex, because `SettingRow`'s own
 * `` `pill${pill.k ? ` ${pill.k}` : ''}` `` nests three levels deep — a
 * fixed-depth pattern silently mis-parses exactly the kind of expression
 * this sweep exists to check.
 */
function classNameSpans(source: string): Array<string> {
  const spans: Array<string> = []
  const marker = 'className='
  let searchFrom = 0
  for (;;) {
    const idx = source.indexOf(marker, searchFrom)
    if (idx === -1) break
    const pos = idx + marker.length
    const opener = source[pos]

    if (opener === '"') {
      const end = source.indexOf('"', pos + 1)
      if (end === -1) break
      spans.push(source.slice(pos, end + 1))
      searchFrom = end + 1
      continue
    }

    if (opener === '{') {
      let depth = 0
      let end = pos
      for (; end < source.length; end++) {
        if (source[end] === '{') depth++
        else if (source[end] === '}') {
          depth--
          if (depth === 0) break
        }
      }
      spans.push(source.slice(pos, end + 1))
      searchFrom = end + 1
      continue
    }

    searchFrom = pos
  }
  return spans
}

/** Every `'...'` / `"..."` / `` `...` `` literal in `text`, matched by delimiter. */
function extractQuotedLiterals(text: string): Array<string> {
  const out: Array<string> = []
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    out.push(match[2])
  }
  return out
}

/**
 * Class tokens a single quoted/template literal can render. A template
 * literal's `${...}` interpolations are stripped from the static text and
 * recursed into (to catch a nested ternary's own quoted strings, as in
 * `` `pill ${logged_in ? 'pill-ok' : 'pill-warn'}` ``); whatever's left is
 * split on whitespace. Non-identifier tokens (Tailwind's
 * `border-[var(--x)]`, `focus-visible:ring-2`) never match the identifier
 * pattern and are dropped — which is what we want, since those come from
 * content that renders outside `matrix-settings.css`'s scope entirely (see
 * the allowlist below).
 */
function classTokensFromLiteral(literal: string): Array<string> {
  const tokens: Array<string> = []
  const withoutInterpolation = literal.replace(/\$\{[^}]*\}/g, (block) => {
    for (const nested of extractQuotedLiterals(block)) {
      tokens.push(...classTokensFromLiteral(nested))
    }
    return ' '
  })
  for (const word of withoutInterpolation.split(/\s+/)) {
    if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(word)) tokens.push(word)
  }
  return tokens
}

function referencedClasses(source: string): Set<string> {
  const classes = new Set<string>()
  for (const span of classNameSpans(source)) {
    if (span.startsWith('"')) {
      for (const token of classTokensFromLiteral(span.slice(1, -1))) classes.add(token)
      continue
    }
    const inner = span.slice(1, -1)
    for (const literal of extractQuotedLiterals(inner)) {
      for (const token of classTokensFromLiteral(literal)) classes.add(token)
    }
  }
  return classes
}

function listSectionFiles(): Array<string> {
  return readdirSync(SECTIONS_DIR)
    .filter((name) => name.startsWith('section-') && name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .sort()
}

/**
 * `section-danger.tsx`'s typed "DELETE" confirmation input renders as a
 * child of `ConfirmDialog` (`../components/confirm-dialog.tsx`), which
 * wraps `shadcn/ui/dialog` and portals to `document.body` — outside
 * `[data-screen='settings']` by design, the same way the `.pf-confirm*`
 * classes it replaced were outside it by accident. Content there
 * deliberately uses global Tailwind utility classes, not this scoped sheet,
 * so those specific tokens are not a bug this sweep should catch.
 */
const ALLOWLIST: Record<string, Array<string>> = {
  'section-danger.tsx': [
    'w-full',
    'rounded-md',
    'border',
    'px-3',
    'py-2',
    'font-mono',
    'text-sm',
    'outline-none',
  ],
}

const files = listSectionFiles()

describe('matrix-settings.css defines every class section JSX references', () => {
  it('covers at least the known section-*.tsx files', () => {
    // A canary, not the contract itself: if this count drops, the discovery
    // glob above broke and the sweep below is silently checking fewer files
    // than it should.
    expect(files.length).toBeGreaterThanOrEqual(27)
  })

  it('finds the class definitions to check against', () => {
    const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
    const defined = definedClasses(css)
    // Canary: if the selector walk breaks, every assertion below passes
    // vacuously.
    expect(defined.size).toBeGreaterThan(30)
    expect(defined.has('btn')).toBe(true)
    expect(defined.has('text-input')).toBe(true)
    expect(defined.has('btn-primary')).toBe(true)
  })

  it.each(files)('%s only references classes matrix-settings.css defines', (fileName) => {
    const css = stripComments(readFileSync(CSS_PATH, 'utf8'))
    const defined = definedClasses(css)
    const source = stripComments(readFileSync(resolve(SECTIONS_DIR, fileName), 'utf8'))
    const referenced = referencedClasses(source)
    const allowed = new Set(ALLOWLIST[fileName] ?? [])

    const missing = [...referenced].filter((cls) => !defined.has(cls) && !allowed.has(cls))

    expect(
      missing,
      `${fileName} references ${missing.length} class(es) matrix-settings.css ` +
        `does not define: ${missing.join(', ')}. Either add the class under ` +
        `[data-screen='settings'] in matrix-settings.css, or — if it's meant ` +
        `to render outside that scope (e.g. inside a portalled dialog) — add ` +
        `it to the ALLOWLIST above with a comment explaining why.`,
    ).toEqual([])
  })
})
