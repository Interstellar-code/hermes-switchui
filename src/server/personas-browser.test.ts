import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPersonas, readPersona } from './personas-browser'

// ── fixture helpers ───────────────────────────────────────────────────────────

function makePersonaFile(
  root: string,
  category: string,
  filename: string,
  content: string,
): void {
  const dir = path.join(root, '.hermes', 'personas', category)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8')
}

const VALID_PERSONA_MD = `---
id: engineering-code-reviewer
category: engineering
glyph: "CR"
name: "Code Reviewer"
description: "Reviews code like a mentor, not a gatekeeper."
tags: [review, quality]
---
You are a Code Reviewer. Every comment teaches something.
`

const VALID_PERSONA_2_MD = `---
id: engineering-software-architect
category: engineering
glyph: "SA"
name: "Software Architect"
description: "Designs systems that survive the team."
tags: [architecture, design]
---
You are a Software Architect. Every decision has a trade-off.
`

// ── setup ─────────────────────────────────────────────────────────────────────

describe('personas-browser', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-personas-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  // ── listPersonas ────────────────────────────────────────────────────────────

  it('returns [] when personas dir does not exist', () => {
    const result = listPersonas()
    expect(result).toEqual([])
  })

  it('returns [] when personas dir exists but is empty', () => {
    fs.mkdirSync(path.join(tempHome, '.hermes', 'personas'), { recursive: true })
    const result = listPersonas()
    expect(result).toEqual([])
  })

  it('parses a valid persona file', () => {
    makePersonaFile(tempHome, 'engineering', 'code-reviewer.md', VALID_PERSONA_MD)
    const result = listPersonas()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('engineering-code-reviewer')
    expect(result[0].category).toBe('engineering')
    expect(result[0].glyph).toBe('CR')
    expect(result[0].name).toBe('Code Reviewer')
    expect(result[0].tags).toEqual(['review', 'quality'])
    expect(result[0].system_prompt).toContain('Every comment teaches something')
  })

  it('returns multiple personas sorted by category then name', () => {
    makePersonaFile(tempHome, 'engineering', 'code-reviewer.md', VALID_PERSONA_MD)
    makePersonaFile(tempHome, 'engineering', 'software-architect.md', VALID_PERSONA_2_MD)
    const result = listPersonas()
    expect(result).toHaveLength(2)
    // "Code Reviewer" < "Software Architect" alphabetically
    expect(result[0].name).toBe('Code Reviewer')
    expect(result[1].name).toBe('Software Architect')
  })

  it('skips files without YAML frontmatter and logs a warning', () => {
    makePersonaFile(tempHome, 'engineering', 'no-frontmatter.md', '# Just a heading\n\nNo frontmatter here.')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = listPersonas()
    expect(result).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no YAML frontmatter'))
    warnSpy.mockRestore()
  })

  it('throws on duplicate persona id', () => {
    makePersonaFile(tempHome, 'engineering', 'cr1.md', VALID_PERSONA_MD)
    makePersonaFile(tempHome, 'engineering', 'cr2.md', VALID_PERSONA_MD) // same id
    expect(() => listPersonas()).toThrow(/Duplicate persona id/)
  })

  // ── readPersona ─────────────────────────────────────────────────────────────

  it('returns null when personas dir does not exist', () => {
    expect(readPersona('engineering-code-reviewer')).toBeNull()
  })

  it('finds a persona by id', () => {
    makePersonaFile(tempHome, 'engineering', 'code-reviewer.md', VALID_PERSONA_MD)
    const persona = readPersona('engineering-code-reviewer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-code-reviewer')
    expect(persona?.system_prompt).toContain('Every comment teaches something')
  })

  it('returns null for unknown id', () => {
    makePersonaFile(tempHome, 'engineering', 'code-reviewer.md', VALID_PERSONA_MD)
    expect(readPersona('does-not-exist')).toBeNull()
  })
})
