import { describe, expect, it } from 'vitest'
import { isToolsetSuppressed } from './toolsets'
import type { NormalizedToolset } from './toolsets'

function toolset(patch: Partial<NormalizedToolset> = {}): NormalizedToolset {
  return {
    key: 'terminal',
    label: 'Terminal & Processes',
    group: 'Core',
    destructive: true,
    plugin: false,
    ...patch,
  }
}

describe('isToolsetSuppressed', () => {
  it('fires when the gateway reports the toolset off but the wizard shows it enabled', () => {
    const ts = toolset({ gatewayEnabled: false })
    expect(isToolsetSuppressed(ts, 'gateway', true)).toBe(true)
  })

  it('does not fire when the wizard already shows it disabled (no contradiction to flag)', () => {
    const ts = toolset({ gatewayEnabled: false })
    expect(isToolsetSuppressed(ts, 'gateway', false)).toBe(false)
  })

  it('does not fire when the gateway reports it enabled', () => {
    const ts = toolset({ gatewayEnabled: true })
    expect(isToolsetSuppressed(ts, 'gateway', true)).toBe(false)
  })

  it('never fires on the static fallback, even if gatewayEnabled were somehow set', () => {
    const ts = toolset({ gatewayEnabled: false })
    expect(isToolsetSuppressed(ts, 'static', true)).toBe(false)
  })

  it('says nothing (does not fire) when gatewayEnabled is undefined', () => {
    const ts = toolset({ gatewayEnabled: undefined })
    expect(isToolsetSuppressed(ts, 'gateway', true)).toBe(false)
  })
})
