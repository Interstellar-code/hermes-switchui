import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  validateKnowledgeCachePath,
  validateKnowledgePathSegment,
} from './knowledge-browser'

// ─── validateKnowledgePathSegment ──────────────────────────────────────────────

describe('validateKnowledgePathSegment', () => {
  // Legitimate branch names that MUST pass
  it.each([
    ['main'],
    ['feature/x'],
    ['release-1.2'],
    ['hotfix/fix-123'],
    ['refs/heads/main'],
    ['v2.3.50'],
    ['user/feature-branch'],
  ])('accepts valid segment: %s', (value) => {
    expect(() => validateKnowledgePathSegment(value, 'branch')).not.toThrow()
  })

  // Path-traversal payloads that MUST be rejected
  it.each([
    ['../../etc', 'dot-dot traversal'],
    ['..', 'bare dot-dot'],
    ['foo/../../bar', 'embedded dot-dot'],
    ['a/../../../etc/passwd', 'repeated dot-dot'],
  ])('rejects traversal payload: %s (%s)', (value) => {
    expect(() => validateKnowledgePathSegment(value, 'branch')).toThrow(
      /\.\./,
    )
  })

  it('rejects absolute path (leading /)', () => {
    expect(() => validateKnowledgePathSegment('/abs/path', 'branch')).toThrow(
      /absolute/,
    )
  })

  it('rejects absolute path (leading backslash)', () => {
    expect(() => validateKnowledgePathSegment('\\abs', 'branch')).toThrow(
      /absolute/,
    )
  })

  it('rejects null byte', () => {
    expect(() =>
      validateKnowledgePathSegment('branch\0name', 'branch'),
    ).toThrow(/null/)
  })

  it('rejects empty string', () => {
    expect(() => validateKnowledgePathSegment('', 'branch')).toThrow()
  })
})

// ─── validateKnowledgeCachePath (containment) ──────────────────────────────────

describe('validateKnowledgeCachePath', () => {
  const expectedRoot = path.join(os.homedir(), '.claude', 'knowledge-cache')

  it('accepts a direct child of the expected root', () => {
    const p = path.join(expectedRoot, 'github', 'owner_repo', 'main', 'docs')
    expect(() => validateKnowledgeCachePath(p, expectedRoot)).not.toThrow()
  })

  it('accepts the expected root itself', () => {
    expect(() =>
      validateKnowledgeCachePath(expectedRoot, expectedRoot),
    ).not.toThrow()
  })

  it('rejects a path that escapes the root (parent dir)', () => {
    const escaped = path.join(os.homedir(), '.claude', 'other-dir')
    expect(() => validateKnowledgeCachePath(escaped, expectedRoot)).toThrow(
      /escaped/,
    )
  })

  it('rejects a path completely outside home', () => {
    expect(() =>
      validateKnowledgeCachePath('/etc/passwd', expectedRoot),
    ).toThrow(/escaped/)
  })

  it('rejects a path that is a prefix-match sibling (not a child)', () => {
    // e.g. knowledge-cache-evil should NOT pass just because it starts with
    // the same characters as knowledge-cache
    const sibling = expectedRoot + '-evil'
    expect(() =>
      validateKnowledgeCachePath(sibling, expectedRoot),
    ).toThrow(/escaped/)
  })
})
