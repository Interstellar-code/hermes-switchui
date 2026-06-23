import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listPersonas, readPersona } from './personas-browser'

// ── integration tests with bundled assets ─────────────────────────────────────
// These tests verify that personas are correctly loaded from assets/personas/curated/

describe('personas-browser (bundled assets)', () => {
  // ── listPersonas ────────────────────────────────────────────────────────────

  it('loads all 16 bundled personas', () => {
    const result = listPersonas()
    expect(result.length).toBeGreaterThanOrEqual(16)
  })

  it('all personas have required fields', () => {
    const result = listPersonas()
    for (const persona of result) {
      expect(persona.id).toBeTruthy()
      expect(persona.category).toBeTruthy()
      expect(persona.glyph).toBeTruthy()
      expect(persona.name).toBeTruthy()
      expect(persona.system_prompt).toBeTruthy()
      expect(Array.isArray(persona.tags)).toBe(true)
    }
  })

  it('personas are sorted by category then name', () => {
    const result = listPersonas()
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]
      const curr = result[i]
      if (prev.category !== curr.category) {
        expect(prev.category.localeCompare(curr.category)).toBeLessThan(0)
      } else {
        expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('finds engineering-code-reviewer by id', () => {
    const persona = readPersona('engineering-code-reviewer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-code-reviewer')
    expect(persona?.glyph).toBe('CR')
    expect(persona?.category).toBe('engineering')
    expect(persona?.system_prompt).toContain('Agent Persona: Code Reviewer')
  })

  it('finds engineering-software-architect by id', () => {
    const persona = readPersona('engineering-software-architect')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-software-architect')
    expect(persona?.glyph).toBe('SA')
    expect(persona?.system_prompt).toContain('Agent Persona: Software Architect')
  })

  it('finds engineering-backend-architect by id', () => {
    const persona = readPersona('engineering-backend-architect')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-backend-architect')
    expect(persona?.glyph).toBe('BA')
  })

  it('finds devops-automator by id', () => {
    const persona = readPersona('devops-automator')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('devops-automator')
    expect(persona?.glyph).toBe('DA')
    expect(persona?.category).toBe('devops')
  })

  it('finds devops-incident-response-commander by id', () => {
    const persona = readPersona('devops-incident-response-commander')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('devops-incident-response-commander')
    expect(persona?.glyph).toBe('IR')
    expect(persona?.category).toBe('devops')
  })

  it('finds engineering-security-engineer by id', () => {
    const persona = readPersona('engineering-security-engineer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-security-engineer')
    expect(persona?.glyph).toBe('SE')
  })

  it('finds product-senior-project-manager by id', () => {
    const persona = readPersona('product-senior-project-manager')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('product-senior-project-manager')
    expect(persona?.glyph).toBe('PM')
    expect(persona?.category).toBe('product')
  })

  it('finds product-sprint-prioritizer by id', () => {
    const persona = readPersona('product-sprint-prioritizer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('product-sprint-prioritizer')
    expect(persona?.glyph).toBe('SP')
    expect(persona?.category).toBe('product')
  })

  it('finds design-ux-architect by id', () => {
    const persona = readPersona('design-ux-architect')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('design-ux-architect')
    expect(persona?.glyph).toBe('UX')
    expect(persona?.category).toBe('design')
  })

  it('finds design-system-curator by id', () => {
    const persona = readPersona('design-system-curator')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('design-system-curator')
    expect(persona?.glyph).toBe('DS')
    expect(persona?.category).toBe('design')
  })

  it('finds research-researcher by id', () => {
    const persona = readPersona('research-researcher')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('research-researcher')
    expect(persona?.glyph).toBe('RE')
    expect(persona?.category).toBe('research')
  })

  it('finds research-data-scientist by id', () => {
    const persona = readPersona('research-data-scientist')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('research-data-scientist')
    expect(persona?.glyph).toBe('DT')
    expect(persona?.category).toBe('research')
  })

  it('finds writing-technical-writer by id', () => {
    const persona = readPersona('writing-technical-writer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('writing-technical-writer')
    expect(persona?.glyph).toBe('TW')
    expect(persona?.category).toBe('writing')
  })

  it('finds writing-doc-curator by id', () => {
    const persona = readPersona('writing-doc-curator')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('writing-doc-curator')
    expect(persona?.glyph).toBe('DC')
    expect(persona?.category).toBe('writing')
  })

  it('finds testing-qa-engineer by id', () => {
    const persona = readPersona('testing-qa-engineer')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('testing-qa-engineer')
    expect(persona?.glyph).toBe('QA')
    expect(persona?.category).toBe('testing')
  })

  it('finds testing-test-strategist by id', () => {
    const persona = readPersona('testing-test-strategist')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('testing-test-strategist')
    expect(persona?.glyph).toBe('TS')
    expect(persona?.category).toBe('testing')
  })

  it('returns null for unknown persona id', () => {
    expect(readPersona('does-not-exist-xyz')).toBeNull()
  })

  it('personas have Hermes-native content with expected sections', () => {
    const codeReviewer = readPersona('engineering-code-reviewer')
    expect(codeReviewer?.system_prompt).toContain('Critical Rules')
    expect(codeReviewer?.system_prompt).toContain('Code Reviewer')
  })

  it('persona frontmatter includes description and tags', () => {
    const architect = readPersona('engineering-software-architect')
    expect(architect?.description).toBeTruthy()
    expect(architect?.tags.length).toBeGreaterThan(0)
  })

  it('engineering-software-architect exposes Phase 1 pre-fill fields', () => {
    const architect = readPersona('engineering-software-architect')
    expect(architect).not.toBeNull()
    expect(architect?.default_model).toBe('claude-opus-4-7')
    expect(architect?.default_memory_provider).toBe('mem0')
    expect(architect?.suggested_mcps).toEqual(['claude-mem', 'context-mode'])
    expect(architect?.suggested_toolsets).toEqual(['core', 'files', 'web'])
  })

  it('all personas with frontmatter pre-fill fields have correct types', () => {
    const result = listPersonas()
    for (const persona of result) {
      if (persona.default_model !== undefined) {
        expect(typeof persona.default_model).toBe('string')
      }
      if (persona.default_memory_provider !== undefined) {
        expect(typeof persona.default_memory_provider).toBe('string')
      }
      if (persona.suggested_mcps !== undefined) {
        expect(Array.isArray(persona.suggested_mcps)).toBe(true)
      }
      if (persona.suggested_toolsets !== undefined) {
        expect(Array.isArray(persona.suggested_toolsets)).toBe(true)
      }
    }
  })
})

// ── duplicate-id handling (issue #181) ────────────────────────────────────────
// Uses a real temp directory passed via the _rootOverride parameter so no
// mocking of fs internals is needed.

describe('personas-browser (duplicate id handling)', () => {
  let tmpDir: string

  const PERSONA_A = `---
id: dupe-test-id
category: engineering
glyph: AA
name: Alpha
description: First persona
tags: []
---
Alpha system prompt.
`

  const PERSONA_B = `---
id: dupe-test-id
category: engineering
glyph: BB
name: Beta
description: Second persona with same id
tags: []
---
Beta system prompt.
`

  const PERSONA_C = `---
id: unique-test-id
category: engineering
glyph: CC
name: Gamma
description: Third persona, unique id
tags: []
---
Gamma system prompt.
`

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'personas-test-'))
    // a-alpha.md sorts before b-beta.md → Alpha is the first occurrence of dupe-test-id
    fs.writeFileSync(path.join(tmpDir, 'a-alpha.md'), PERSONA_A)
    fs.writeFileSync(path.join(tmpDir, 'b-beta.md'), PERSONA_B)
    fs.writeFileSync(path.join(tmpDir, 'c-gamma.md'), PERSONA_C)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('does not throw when a duplicate persona id is encountered', () => {
    expect(() => listPersonas(tmpDir)).not.toThrow()
  })

  it('returns an array (not undefined/null) when duplicates exist', () => {
    const result = listPersonas(tmpDir)
    expect(Array.isArray(result)).toBe(true)
  })

  it('keeps only the first occurrence of a duplicate id', () => {
    const result = listPersonas(tmpDir)
    const dupes = result.filter((p) => p.id === 'dupe-test-id')
    expect(dupes).toHaveLength(1)
    // a-alpha.md is read first (alphabetical order); glyph AA = first occurrence kept
    expect(dupes[0].glyph).toBe('AA')
  })

  it('still includes personas with unique ids after skipping duplicates', () => {
    const result = listPersonas(tmpDir)
    const gamma = result.find((p) => p.id === 'unique-test-id')
    expect(gamma).toBeDefined()
    expect(gamma?.glyph).toBe('CC')
  })

  it('returns 2 personas total (1 dupe dropped, 2 unique kept)', () => {
    const result = listPersonas(tmpDir)
    expect(result).toHaveLength(2)
  })

  it('emits a console.warn for the duplicate', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    listPersonas(tmpDir)
    const warned = warnSpy.mock.calls.some((args) =>
      String(args[0]).includes('dupe-test-id'),
    )
    expect(warned).toBe(true)
    warnSpy.mockRestore()
  })
})
