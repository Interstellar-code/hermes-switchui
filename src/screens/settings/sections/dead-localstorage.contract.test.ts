import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards against the exact bug that motivated Stream 1B of plan
 * immutable-noodling-koala: settings sections that call
 * `set('hermes.<key>', …)` on the settings draft store to write a
 * `hermes.*` localStorage-backed key that no code outside
 * src/screens/settings/ ever reads. Those controls persist perfectly and do
 * nothing — the Matrix-rain toggle never reaches the rain canvas (which
 * mounts unconditionally), the six keyboard shortcuts have no handler,
 * "hardware acceleration" has no meaning in a browser page, and the density
 * control has no implementation. 24 such controls plus one always-empty
 * read-only field were deleted outright rather than fixed, because nothing
 * downstream would have noticed either way.
 *
 * The one legitimate exception is `hermes.theme` in section-appearance.tsx:
 * `setTheme()` genuinely writes the real `claude-theme` localStorage key and
 * applies immediately (see src/lib/theme.ts). That card was deliberately
 * severed from the draft store, so it no longer calls `set('hermes.theme'…)`
 * either — the allowlist below exists only in case a future edit re-adds a
 * store-backed `hermes.*` write to that file, which would reintroduce this
 * exact bug in the one file most likely to have a "looks legitimate" excuse.
 *
 * The file list is discovered at test-run time (not hand-maintained) so a
 * new `section-*.tsx` file is covered automatically, and each file's check
 * runs as its own named `it.each` test so a failure names the offending file
 * directly instead of a single "some section is broken" assertion.
 */
const ROOT = process.cwd()
const SECTIONS_DIR = resolve(ROOT, 'src/screens/settings/sections')

/** section-appearance.tsx is allowed to write only the live theme key. */
const DEAD_KEY_ALLOWLIST: Record<string, Array<string>> = {
  'section-appearance.tsx': [],
}

function listSectionFiles(): Array<string> {
  return readdirSync(SECTIONS_DIR)
    .filter((name) => name.startsWith('section-') && name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .sort()
}

const files = listSectionFiles()

describe('no section writes a dead hermes.* localStorage key via the settings store', () => {
  it('covers at least the known section-*.tsx files', () => {
    // A canary, not the contract itself: if this count drops, the discovery
    // glob above broke and the sweep below is silently checking fewer files
    // than it should.
    expect(files.length).toBeGreaterThanOrEqual(27)
  })

  it.each(files)('%s does not write set(\'hermes.<key>\', …) to the draft store', (fileName) => {
    const source = readFileSync(resolve(SECTIONS_DIR, fileName), 'utf8')
    const matches = [...source.matchAll(/set\(\s*'hermes\.[^']*'/g)].map((m) => m[0])
    const allowed = DEAD_KEY_ALLOWLIST[fileName] ?? []
    const offenders = matches.filter((m) => !allowed.some((a) => m.includes(a)))

    expect(
      offenders,
      `${fileName} calls the settings draft store's set('hermes.<key>', …) ` +
        `for a key nothing outside src/screens/settings/ reads: ${offenders.join(', ')}. ` +
        `If this is a genuinely new local-only setting, either wire a real ` +
        `reader for it or don't add it as a draft-store key.`,
    ).toEqual([])
  })
})
