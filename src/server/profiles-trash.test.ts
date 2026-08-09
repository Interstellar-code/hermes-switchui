import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  listTrashedProfiles,
  purgeTrashedProfile,
  restoreTrashedProfile,
} from './profiles-trash'
import { listProfiles } from './profiles-browser'

describe('profiles-trash', () => {
  let tempHome: string
  let hermesRoot: string
  let profilesRoot: string
  let trashRoot: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-switchui-trash-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
    hermesRoot = path.join(tempHome, '.hermes')
    profilesRoot = path.join(hermesRoot, 'profiles')
    trashRoot = path.join(hermesRoot, 'trash')
    fs.mkdirSync(profilesRoot, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function trashEntry(id: string, files: Record<string, string> = {}): string {
    const dir = path.join(trashRoot, id)
    fs.mkdirSync(dir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf-8')
    }
    return dir
  }

  describe('listTrashedProfiles', () => {
    it('returns an empty array when the trash directory does not exist', () => {
      expect(listTrashedProfiles()).toEqual([])
    })

    it('parses <name>-<epochMs> and sorts newest first', () => {
      const older = Date.now() - 100_000
      const newer = Date.now()
      trashEntry(`jarvis-${older}`)
      trashEntry(`friday-${newer}`)

      const results = listTrashedProfiles()
      expect(results.map((r) => r.originalName)).toEqual(['friday', 'jarvis'])
      expect(results[0].id).toBe(`friday-${newer}`)
      expect(results[0].deletedAt).toBe(new Date(newer).toISOString())
      expect(results[1].deletedAt).toBe(new Date(older).toISOString())
      for (const r of results) {
        expect(r.path).toBe(path.join(trashRoot, r.id))
      }
    })

    it('survives a stray file in the trash directory', () => {
      fs.mkdirSync(trashRoot, { recursive: true })
      fs.writeFileSync(path.join(trashRoot, 'not-a-dir.txt'), 'hi', 'utf-8')
      trashEntry(`jarvis-${Date.now()}`)

      const results = listTrashedProfiles()
      expect(results).toHaveLength(1)
      expect(results[0].originalName).toBe('jarvis')
    })

    it('falls back to the whole name + dir mtime for a malformed suffix', () => {
      // No numeric suffix at all.
      trashEntry('weird-name-no-timestamp')

      const results = listTrashedProfiles()
      expect(results).toHaveLength(1)
      expect(results[0].originalName).toBe('weird-name-no-timestamp')
      expect(results[0].id).toBe('weird-name-no-timestamp')
      // deletedAt should be a valid ISO timestamp derived from mtime, not NaN.
      expect(Number.isNaN(Date.parse(results[0].deletedAt))).toBe(false)
    })

    it('falls back for a short trailing number that is not a plausible epoch', () => {
      // "-42" looks like <name>-<number> but 2 digits is not a real epoch-ms suffix.
      trashEntry('agent-42')

      const results = listTrashedProfiles()
      expect(results).toHaveLength(1)
      expect(results[0].originalName).toBe('agent-42')
    })

    it('computes sizeBytes for a trashed entry', () => {
      trashEntry(`bigagent-${Date.now()}`, { 'config.yaml': 'model: auto\n' })
      const results = listTrashedProfiles()
      expect(results[0].sizeBytes).toBeGreaterThan(0)
    })
  })

  describe('restoreTrashedProfile', () => {
    it('moves the directory back to profiles/<originalName> and returns the name', () => {
      const id = `jarvis-${Date.now()}`
      trashEntry(id, { 'config.yaml': 'model: auto\n' })

      const result = restoreTrashedProfile(id)
      expect(result).toEqual({ name: 'jarvis' })
      expect(fs.existsSync(path.join(trashRoot, id))).toBe(false)
      expect(fs.existsSync(path.join(profilesRoot, 'jarvis'))).toBe(true)
      expect(
        fs.readFileSync(path.join(profilesRoot, 'jarvis', 'config.yaml'), 'utf-8'),
      ).toBe('model: auto\n')
    })

    it('rejects restoring onto an existing profile', () => {
      const id = `jarvis-${Date.now()}`
      trashEntry(id)
      fs.mkdirSync(path.join(profilesRoot, 'jarvis'), { recursive: true })

      expect(() => restoreTrashedProfile(id)).toThrow('Profile already exists')
      // Original trash entry must be left untouched.
      expect(fs.existsSync(path.join(trashRoot, id))).toBe(true)
    })

    it('rejects restoring an unknown id', () => {
      expect(() => restoreTrashedProfile('does-not-exist-1234567890')).toThrow(
        'Trashed profile not found',
      )
    })

    it.each(['../../etc', 'a/b', 'a\\b'])(
      'rejects a path-unsafe id %j',
      (badId) => {
        expect(() => restoreTrashedProfile(badId)).toThrow('Invalid trash id')
      },
    )

    it('makes the restored profile visible in listProfiles() immediately, not after the 5s cache TTL', () => {
      // Warm profiles-browser's 5s listProfiles() cache with a snapshot that
      // predates the restore. Point active_profile at the named profile so
      // listProfiles() doesn't also inject its synthetic 'default' row.
      fs.mkdirSync(path.join(profilesRoot, 'other'), { recursive: true })
      fs.writeFileSync(path.join(hermesRoot, 'active_profile'), 'other\n', 'utf-8')
      const before = listProfiles()
      expect(before.map((p) => p.name)).toEqual(['other'])

      const id = `jarvis-${Date.now()}`
      trashEntry(id)
      restoreTrashedProfile(id)

      // Read again right away — well inside the TTL window. Without
      // restoreTrashedProfile() invalidating the cache, this would still
      // return the stale `before` snapshot and miss 'jarvis'.
      const after = listProfiles()
      expect(after.map((p) => p.name).sort()).toEqual(['jarvis', 'other'])
    })
  })

  describe('purgeTrashedProfile', () => {
    it('permanently removes the trashed directory', () => {
      const id = `jarvis-${Date.now()}`
      const dir = trashEntry(id, { 'config.yaml': 'model: auto\n' })

      purgeTrashedProfile(id)
      expect(fs.existsSync(dir)).toBe(false)
    })

    it('rejects purging an unknown id', () => {
      expect(() => purgeTrashedProfile('does-not-exist-1234567890')).toThrow(
        'Trashed profile not found',
      )
    })

    it.each(['../../etc', 'a/b', 'a\\b'])(
      'rejects a path-unsafe id %j',
      (badId) => {
        expect(() => purgeTrashedProfile(badId)).toThrow('Invalid trash id')
      },
    )
  })
})
