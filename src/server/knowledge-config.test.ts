import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getKnowledgeBaseEffectiveRoot,
  readKnowledgeBaseConfig,
} from './knowledge-config'

const originalEnv = { ...process.env }
let tempRoot = ''

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-knowledge-config-'))
  process.env = { ...originalEnv, HERMES_HOME: tempRoot }
})

afterEach(() => {
  process.env = { ...originalEnv }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('knowledge-config matrix memory cutover', () => {
  it('upgrades legacy Hermes wiki config to the matrix-memory wiki root when present', () => {
    const legacyWikiRoot = path.join(
      os.homedir(),
      'hermes',
      'wikis',
      'hermes-switchui',
    )
    const matrixWikiRoot = path.join(
      tempRoot,
      'profiles',
      'hermes-switch',
      'matrix-memory',
      'wiki',
    )
    fs.mkdirSync(matrixWikiRoot, { recursive: true })
    fs.writeFileSync(
      path.join(tempRoot, 'knowledge-config.json'),
      JSON.stringify({ source: { type: 'local', path: legacyWikiRoot } }),
      'utf-8',
    )

    const config = readKnowledgeBaseConfig()
    expect(config).toEqual({
      source: { type: 'local', path: matrixWikiRoot },
    })
    expect(getKnowledgeBaseEffectiveRoot()).toBe(matrixWikiRoot)
  })

  it('preserves explicit non-legacy local wiki roots', () => {
    const customWikiRoot = path.join(tempRoot, 'custom-wiki')
    fs.mkdirSync(customWikiRoot, { recursive: true })
    fs.writeFileSync(
      path.join(tempRoot, 'knowledge-config.json'),
      JSON.stringify({ source: { type: 'local', path: customWikiRoot } }),
      'utf-8',
    )

    const config = readKnowledgeBaseConfig()
    expect(config).toEqual({
      source: { type: 'local', path: customWikiRoot },
    })
    expect(getKnowledgeBaseEffectiveRoot()).toBe(customWikiRoot)
  })
})
