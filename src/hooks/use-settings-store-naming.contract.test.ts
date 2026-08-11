import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-text guard on a name collision, not a behavioural bug.
 *
 * `src/hooks/use-settings.ts` used to export a zustand hook called
 * `useSettingsStore` — the exact identifier `src/stores/settings-store.ts`
 * (the gateway-config draft store Wave 1 rewrote) also exports. The two
 * stores share nothing but the name: one is browser-local Studio prefs
 * (theme mode, editor font size, chat nav mode…) persisted under the
 * localStorage key `claude-settings`; the other is the draft/committed/dirty
 * state behind the `/settings` route and the `PUT /api/config` transport.
 *
 * A shared identifier across two unrelated stores is exactly the condition
 * that made the original save-honesty bug (see
 * `settings-transport.contract.test.ts`) hard to reason about: every
 * `grep useSettingsStore` returned hits from both stores with no way to tell
 * them apart, and an import from the wrong module type-checks fine — React
 * hooks don't care which store shaped like `(selector) => T` they call. There
 * is no import edge that catches a reintroduced collision, hence a text
 * contract.
 *
 * The hook in `use-settings.ts` was renamed to `useStudioSettingsStore`. Its
 * persisted localStorage key stays `claude-settings` — renaming that would
 * silently drop every user's stored prefs, which is not part of this fix.
 */

const ROOT = process.cwd()

/** Every `.ts`/`.tsx` file under `src/`, walked at test-run time. */
function listSourceFiles(): Array<string> {
  const root = resolve(ROOT, 'src')
  const out: Array<string> = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue
      const full = join(dir, entry)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (
        (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
        !entry.includes('.test.') &&
        !entry.endsWith('.contract.test.ts')
      ) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out
}

const EXPORT_PATTERN = /export\s+(?:const|function)\s+useSettingsStore\b/

describe('useSettingsStore naming collision', () => {
  const files = listSourceFiles()

  it('walks a non-trivial slice of src/ (canary)', () => {
    // If the glob logic above breaks, the sweep below silently checks zero
    // files and every assertion passes vacuously.
    expect(files.length).toBeGreaterThan(500)
  })

  it('exactly one module exports useSettingsStore', () => {
    const owners = files.filter((path) =>
      EXPORT_PATTERN.test(readFileSync(path, 'utf8')),
    )
    expect(owners.map((p) => p.slice(resolve(ROOT, 'src').length + 1))).toEqual(
      ['stores/settings-store.ts'],
    )
  })

  it('use-settings.ts exports useStudioSettingsStore, not useSettingsStore', () => {
    const src = readFileSync(resolve(ROOT, 'src/hooks/use-settings.ts'), 'utf8')
    expect(src).toMatch(/export\s+const\s+useStudioSettingsStore\b/)
    expect(src).not.toMatch(EXPORT_PATTERN)
    // The persisted key must survive the rename or users lose their prefs.
    expect(src).toMatch(/name:\s*'claude-settings'/)
  })

  it('no source file imports two different useSettingsStores under one name', () => {
    // A file that imports `useSettingsStore` from both modules would shadow
    // one with the other; TypeScript would catch a literal duplicate import,
    // but not a case where only one is imported yet the identifier is later
    // assumed to be the other store's shape. The real guard is that only one
    // module can export the name at all (asserted above) — this test just
    // documents the invariant that makes that sufficient.
    const offenders = files.filter((path) => {
      const src = readFileSync(path, 'utf8')
      return /import\s*\{[^}]*\buseSettingsStore\b[^}]*\}\s*from\s*'@\/hooks\/use-settings'/.test(
        src,
      )
    })
    expect(offenders).toEqual([])
  })
})
