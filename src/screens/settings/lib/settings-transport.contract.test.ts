import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Source-text guard on the Settings write path.
 *
 * The bug: `hermes-client.ts` sent `PATCH /api/config`, but the Hermes
 * dashboard registers only GET and PUT for that route, so every save returned
 * 405. `saver.ts` caught the rejection and only surfaced it when the message
 * matched `'400'`, so the 405 vanished, and the store committed the draft
 * unconditionally — the save bar said "Saved" while ~40 settings across 11
 * sections, including approval mode and the command allowlist, were never
 * written. The security surface confirmed changes it never applied.
 *
 * There is no import edge that can catch a regression here: reintroducing
 * PATCH, or re-adding a `.includes('400')` swallow, type-checks fine and only
 * fails against a live gateway. Hence a text contract.
 */

const clientSrc = readFileSync(
  new URL('../../../lib/hermes-client.ts', import.meta.url),
  'utf8',
)
const saverSrc = readFileSync(new URL('./saver.ts', import.meta.url), 'utf8')

describe('settings transport contract', () => {
  it('reads both source files (canary)', () => {
    // If a rename or a bad URL makes these empty, every assertion below
    // passes vacuously.
    expect(clientSrc.length).toBeGreaterThan(500)
    expect(saverSrc.length).toBeGreaterThan(500)
  })

  it('hermes-client never sends PATCH to /api/config', () => {
    expect(clientSrc).not.toMatch(/['"]PATCH['"]\s*,\s*['"]\/api\/config['"]/)
  })

  it('hermes-client sends PUT to /api/config', () => {
    expect(clientSrc).toMatch(/['"]PUT['"]\s*,\s*['"]\/api\/config['"]/)
  })

  it('hermes-client exports putConfig and no longer exports patchConfig', () => {
    expect(clientSrc).toMatch(/export async function putConfig\b/)
    expect(clientSrc).not.toMatch(/export async function patchConfig\b/)
  })

  it('the saver imports putConfig and not patchConfig', () => {
    expect(saverSrc).toMatch(/import\s*\{\s*putConfig\s*\}\s*from\s*'@\/lib\/hermes-client'/)
    expect(saverSrc).not.toMatch(/\bpatchConfig\b/)
  })

  it('the saver does not string-match error codes to decide what to report', () => {
    expect(saverSrc).not.toContain(".includes('400')")
    expect(saverSrc).not.toContain('.includes("400")')
  })

  it('the saver does not toast — the screen owns messaging', () => {
    expect(saverSrc).not.toMatch(/from\s*'@\/components\/ui\/toast'/)
  })
})
