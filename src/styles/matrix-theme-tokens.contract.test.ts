import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  declaredThemeTokens,
  findBadMatrixFallbacks,
  findUnknownThemeFallbacks,
  stripComments,
} from '@/lib/css-contract'

/**
 * Sweep test for the bug that `providers-theme.contract.test.ts`,
 * `wizard-theme.contract.test.ts` and `onboarding-theme.contract.test.ts`
 * each catch on their own single file: a `var(--m-X, <literal>)` fallback on
 * a Matrix-only colour token, which paints Matrix colours on the nine
 * non-Matrix themes instead of falling back to that theme's own
 * `--theme-*` value.
 *
 * Those three stylesheets have dedicated tests. Every other `matrix-*.css`
 * file and every `.css` file under `src/screens/` does not — which is
 * exactly why the `--m-danger` / `--m-warning` / `--m-info` / `--m-success`
 * fallback bug this file was added to catch was able to spread through
 * `matrix-providers.css`, `matrix-conductor.css`, `matrix-operations.css`,
 * `matrix-backups.css` and `matrix-tasks.css` unnoticed. Rather than write a
 * fourth near-duplicate per-file test, this sweeps every candidate file so
 * the next drift — in this family or any other `colourish` one — fails loud
 * instead of shipping quietly.
 *
 * The file list is discovered at test-run time (not hand-maintained) so a
 * new `matrix-*.css` or `src/screens/**‍/*.css` file is covered automatically.
 */
const ROOT = process.cwd()

/**
 * Every stylesheet in `src/styles`, not just `matrix-*`. `docs-prose.css`
 * sits in the same folder, uses the same `--m-*` tokens, and carried the same
 * bug — a name-prefix filter would have kept missing it.
 */
function listMatrixStylesheets(): Array<string> {
  return readdirSync(resolve(ROOT, 'src/styles'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => join('src/styles', name))
}

function listScreenStylesheets(): Array<string> {
  const root = resolve(ROOT, 'src/screens')
  const out: Array<string> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (entry.endsWith('.css')) out.push(relative(ROOT, full))
    }
  }
  walk(root)
  return out.sort()
}

const files = [...listMatrixStylesheets(), ...listScreenStylesheets()].sort()

describe('matrix theme token fallbacks (sweep)', () => {
  it('covers at least the known matrix-*.css and screens/**/*.css files', () => {
    // A canary, not the contract itself: if this count drops, the glob
    // logic above broke and the sweep below is silently checking fewer
    // files than it should.
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  it.each(files)('%s has no bad Matrix fallback', (relPath) => {
    const css = readFileSync(resolve(ROOT, relPath), 'utf8')
    const bad = findBadMatrixFallbacks(stripComments(css))
    expect(
      bad,
      `${relPath} has ${bad.length} var(--m-*) colour reference(s) with a ` +
        `literal or missing fallback instead of var(--theme-*): ` +
        `${bad.join(', ')}`,
    ).toEqual([])
  })

  /**
   * Chaining to a `--theme-*` token that no theme declares is the same bug
   * wearing the right clothes: the chain still resolves to nothing outside
   * Matrix, but it satisfies a check that only looks for the text
   * `var(--theme-`. Three stylesheets had accumulated references to
   * `--theme-fg`, `--theme-hover` and `--theme-bg-deep`, none of which exist.
   */
  describe('theme fallbacks point at tokens that exist', () => {
    const declared = declaredThemeTokens(
      readFileSync(resolve(ROOT, 'src/styles.css'), 'utf8'),
    )

    it('finds the theme token declarations to check against', () => {
      // Canary: if the parse breaks, every assertion below passes vacuously.
      expect(declared.size).toBeGreaterThan(20)
      expect(declared.has('--theme-bg')).toBe(true)
      expect(declared.has('--theme-fg')).toBe(false)
    })

    it.each(files)('%s chains only to declared theme tokens', (relPath) => {
      const css = readFileSync(resolve(ROOT, relPath), 'utf8')
      const unknown = findUnknownThemeFallbacks(css, declared)
      expect(
        unknown,
        `${relPath} references ${unknown.length} --theme-* token(s) that no ` +
          `theme declares, so they resolve to nothing outside Matrix: ` +
          `${unknown.join(', ')}`,
      ).toEqual([])
    })
  })
})
