import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { listPersonas, readPersona } from './personas-browser'

// ── integration tests with bundled assets ─────────────────────────────────────
// These tests verify that personas are correctly loaded from assets/personas/curated/

describe('personas-browser (bundled assets)', () => {
  // ── listPersonas ────────────────────────────────────────────────────────────

  it('loads all 8 bundled personas', () => {
    const result = listPersonas()
    expect(result.length).toBeGreaterThanOrEqual(8)
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

  it('finds engineering-devops-automator by id', () => {
    const persona = readPersona('engineering-devops-automator')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-devops-automator')
    expect(persona?.glyph).toBe('DA')
  })

  it('finds engineering-incident-response-commander by id', () => {
    const persona = readPersona('engineering-incident-response-commander')
    expect(persona).not.toBeNull()
    expect(persona?.id).toBe('engineering-incident-response-commander')
    expect(persona?.glyph).toBe('IR')
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
})
