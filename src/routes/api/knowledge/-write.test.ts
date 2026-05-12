/**
 * Tests for /api/knowledge/write handler — CSRF guard and raw/ path rejection.
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requireJsonContentType } from '../../../server/rate-limit'
import { writeKnowledgePage, deleteKnowledgePage } from '../../../server/knowledge-browser'

const originalEnv = { ...process.env }
let tempRoot = ''
let knowledgeRoot = ''

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-knowledge-write-'))
  knowledgeRoot = path.join(tempRoot, 'wiki')
  fs.mkdirSync(knowledgeRoot, { recursive: true })

  process.env = { ...originalEnv }
  // Point HERMES_HOME to temp so config reads from there
  process.env.HERMES_HOME = tempRoot
  // Write a knowledge-config.json pointing at our temp wiki dir
  fs.writeFileSync(
    path.join(tempRoot, 'knowledge-config.json'),
    JSON.stringify({ source: { type: 'local', path: knowledgeRoot } }),
    'utf-8',
  )
})

afterEach(() => {
  process.env = { ...originalEnv }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

// ── CSRF guard (requireJsonContentType) ───────────────────────────────────────

describe('requireJsonContentType (CSRF guard)', () => {
  it('returns 415 when Content-Type is missing', () => {
    const req = new Request('http://localhost/api/knowledge/write', {
      method: 'POST',
      body: '{}',
    })
    const result = requireJsonContentType(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(415)
  })

  it('returns 415 for application/x-www-form-urlencoded (cross-origin form POST vector)', () => {
    const req = new Request('http://localhost/api/knowledge/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'path=foo.md&content=evil',
    })
    const result = requireJsonContentType(req)
    expect(result).not.toBeNull()
    expect(result?.status).toBe(415)
  })

  it('returns null (passes) for application/json', () => {
    const req = new Request('http://localhost/api/knowledge/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(requireJsonContentType(req)).toBeNull()
  })
})

// ── raw/ path rejection ───────────────────────────────────────────────────────

describe('writeKnowledgePage raw/ rejection', () => {
  it('throws when path starts with raw/', () => {
    expect(() => writeKnowledgePage('raw/ingest.md', '# data')).toThrow(
      'Writes to raw/ are not allowed',
    )
  })

  it('throws for nested raw/ path', () => {
    expect(() => writeKnowledgePage('raw/subdir/file.md', '# data')).toThrow(
      'Writes to raw/ are not allowed',
    )
  })

  it('allows write to a curated path', () => {
    const meta = writeKnowledgePage('notes/test-page.md', '# Hello')
    expect(meta.path).toBe('notes/test-page.md')
    expect(fs.existsSync(path.join(knowledgeRoot, 'notes', 'test-page.md'))).toBe(true)
  })
})

describe('deleteKnowledgePage raw/ rejection', () => {
  it('throws when path starts with raw/', () => {
    // Create the raw file first so path traversal check passes before isCuratedPage
    fs.mkdirSync(path.join(knowledgeRoot, 'raw'), { recursive: true })
    fs.writeFileSync(path.join(knowledgeRoot, 'raw', 'ingest.md'), '# raw')

    expect(() => deleteKnowledgePage('raw/ingest.md')).toThrow(
      'Writes to raw/ are not allowed',
    )
    // Verify file was NOT deleted
    expect(fs.existsSync(path.join(knowledgeRoot, 'raw', 'ingest.md'))).toBe(true)
  })
})
