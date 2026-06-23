import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetCacheForTest, readActiveModel } from './_connection-status-cache-helper'

/**
 * Tests for #136 — mtime-gated config cache in readActiveModel().
 *
 * We spy on node:fs.statSync and node:fs.readFileSync directly and reset
 * the module-level cache via _resetCacheForTest() between tests so each
 * test starts with a cold cache.
 */

const CONFIG_PATH = '/fake/.hermes/config.yaml'

// Minimal YAML covering both config shapes
const YAML_STRING = 'model: claude-3-7-sonnet\n'
const YAML_OBJECT = 'model:\n  default: claude-opus-4\n'

let statSyncSpy: ReturnType<typeof vi.spyOn>
let readFileSyncSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  _resetCacheForTest()
  statSyncSpy = vi.spyOn(fs, 'statSync')
  readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readActiveModel — mtime-gated cache (#136)', () => {
  it('first call reads and parses config with a string model field', () => {
    statSyncSpy.mockReturnValue({ mtimeMs: 1000 })
    readFileSyncSpy.mockReturnValue(YAML_STRING)

    const result = readActiveModel(CONFIG_PATH)

    expect(result).toBe('claude-3-7-sonnet')
    expect(statSyncSpy).toHaveBeenCalledTimes(1)
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1)
  })

  it('first call reads and parses config with an object model.default field', () => {
    statSyncSpy.mockReturnValue({ mtimeMs: 1000 })
    readFileSyncSpy.mockReturnValue(YAML_OBJECT)

    const result = readActiveModel(CONFIG_PATH)

    expect(result).toBe('claude-opus-4')
  })

  it('second call with unchanged mtime returns cached value without re-reading', () => {
    statSyncSpy.mockReturnValue({ mtimeMs: 5000 })
    readFileSyncSpy.mockReturnValue(YAML_STRING)

    const first = readActiveModel(CONFIG_PATH)
    const second = readActiveModel(CONFIG_PATH)

    expect(first).toBe('claude-3-7-sonnet')
    expect(second).toBe('claude-3-7-sonnet')
    // readFileSync called exactly once despite two invocations
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1)
    // statSync called twice — the cheap mtime guard runs every time
    expect(statSyncSpy).toHaveBeenCalledTimes(2)
  })

  it('re-reads and re-parses when mtime changes', () => {
    statSyncSpy
      .mockReturnValueOnce({ mtimeMs: 1000 })
      .mockReturnValueOnce({ mtimeMs: 9999 })
    readFileSyncSpy
      .mockReturnValueOnce(YAML_STRING)
      .mockReturnValueOnce(YAML_OBJECT)

    const first = readActiveModel(CONFIG_PATH)
    const second = readActiveModel(CONFIG_PATH)

    expect(first).toBe('claude-3-7-sonnet')
    expect(second).toBe('claude-opus-4')
    expect(readFileSyncSpy).toHaveBeenCalledTimes(2)
  })

  it('returns empty string when config file is missing (statSync throws ENOENT)', () => {
    statSyncSpy.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = readActiveModel(CONFIG_PATH)

    expect(result).toBe('')
    expect(readFileSyncSpy).not.toHaveBeenCalled()
  })

  it('returns empty string when readFileSync throws (permission denied)', () => {
    statSyncSpy.mockReturnValue({ mtimeMs: 1000 })
    readFileSyncSpy.mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })

    const result = readActiveModel(CONFIG_PATH)

    expect(result).toBe('')
  })

  it('returns empty string when config has no model field', () => {
    statSyncSpy.mockReturnValue({ mtimeMs: 1000 })
    readFileSyncSpy.mockReturnValue('providers:\n  openai: {}\n')

    const result = readActiveModel(CONFIG_PATH)

    expect(result).toBe('')
  })
})
