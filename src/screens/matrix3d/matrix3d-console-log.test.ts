import { describe, expect, it } from 'vitest'
import { buildLogEntries, shouldSuppressConsoleLine } from './matrix3d-console-log'

describe('matrix3d-console-log', () => {
  it('suppresses gateway health chatter', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:36:37 INFO gateway.health: health report node=alpha status=ok',
        'gateway',
      ),
    ).toBe(true)
  })

  it('suppresses routine gateway polling access logs', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:37:18,483 INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/jobs HTTP/1.1" 401 334 "-"',
        'gateway',
      ),
    ).toBe(true)
  })

  it('suppresses generic /api access chatter with 404s', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:37:18,483 INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/sessions?limit=1 HTTP/1.1" 404 174 "-" "node"',
        'gateway',
      ),
    ).toBe(true)
  })

  it('suppresses expected /api/logs 404 polling noise', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:37:18,483 INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/logs?lines=200&file=gateway HTTP/1.1" 404 174 "-" "node"',
        'gateway',
      ),
    ).toBe(true)
  })

  it('keeps non-routine gateway failures visible', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:37:18,483 INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/jobs HTTP/1.1" 500 334 "-"',
        'gateway',
      ),
    ).toBe(false)
  })

  it('keeps operator-relevant gateway lines visible', () => {
    expect(
      shouldSuppressConsoleLine(
        '20:36:37 INFO gateway.run: inbound message: platform=telegram user=Rohit Sharma channel=dm',
        'gateway',
      ),
    ).toBe(false)
  })

  it('filters noise before truncating visible entries', () => {
    const raw = {
      lines: [
        ...Array.from(
          { length: 12 },
          (_, index) =>
            `20:36:${String(index).padStart(2, '0')} INFO gateway.run: inbound message ${index}`,
        ),
        ...Array.from(
          { length: 90 },
          (_, index) =>
            `20:37:${String(index % 60).padStart(2, '0')} INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/jobs HTTP/1.1" 401 334 "-"`,
        ),
      ],
    }

    const entries = buildLogEntries(raw, 'gateway', [])

    expect(entries).toHaveLength(12)
    expect(entries[0]?.message).toContain('inbound message 0')
    expect(entries[11]?.message).toContain('inbound message 11')
  })

  it('can include noisy entries for debug toggle views', () => {
    const raw = {
      lines: [
        '20:37:18,483 INFO aiohttp.access: 127.0.0.1 [14/May/2026:20:37:18 +0200] "GET /api/logs?lines=200&file=gateway HTTP/1.1" 404 174 "-" "node"',
        '20:36:01 INFO gateway.run: inbound message visible',
      ],
    }

    const entries = buildLogEntries(raw, 'gateway', [], { includeNoise: true })

    expect(entries).toHaveLength(2)
    expect(entries[0]?.noisy).toBe(true)
    expect(entries[1]?.noisy).toBe(false)
  })
})
