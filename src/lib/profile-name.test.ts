import { describe, expect, it } from 'vitest'

import {
  PROFILE_NAME_MESSAGE,
  PROFILE_NAME_RE,
  PROFILE_NAME_REQUIRED_MESSAGE,
  WIZARD_NAME_MESSAGE,
  WIZARD_NAME_RE,
  isValidProfileName,
  isValidWizardProfileName,
  profileNameError,
  sanitizeProfileName,
} from './profile-name'

describe('PROFILE_NAME_RE — the canonical on-disk rule', () => {
  it.each([
    // Every built-in that already exists on disk must keep validating.
    'hermes-switch',
    'neo',
    'trinity',
    'morpheus',
    // Legacy underscore names predate the hyphen convention.
    'a_b-c',
    'my_old_profile',
    // Digits are fine anywhere, including first.
    '0',
    '2026-agent',
    'a'.repeat(64),
  ])('accepts %j', (name) => {
    expect(PROFILE_NAME_RE.test(name)).toBe(true)
    expect(isValidProfileName(name)).toBe(true)
    expect(profileNameError(name)).toBeNull()
  })

  it.each([
    ['', 'empty'],
    ['My Agent!!', 'uppercase, spaces and punctuation'],
    ['-leading', 'leading hyphen'],
    ['_leading', 'leading underscore'],
    ['UPPER', 'uppercase'],
    ['has space', 'space'],
    ['dot.name', 'dot'],
    ['a'.repeat(65), '65 characters'],
  ])('rejects %j (%s)', (name) => {
    expect(PROFILE_NAME_RE.test(name)).toBe(false)
    expect(isValidProfileName(name)).toBe(false)
    expect(profileNameError(name)).not.toBeNull()
  })

  it('reports the required-field message for blank input, not the shape message', () => {
    expect(profileNameError('')).toBe(PROFILE_NAME_REQUIRED_MESSAGE)
    expect(profileNameError('   ')).toBe(PROFILE_NAME_REQUIRED_MESSAGE)
    expect(profileNameError('Bad Name')).toBe(PROFILE_NAME_MESSAGE)
  })

  it('trims surrounding whitespace before validating, like the server does', () => {
    expect(isValidProfileName('  neo  ')).toBe(true)
    expect(profileNameError('  neo  ')).toBeNull()
  })

  it('is stateless across calls (no /g flag / lastIndex carry-over)', () => {
    expect(PROFILE_NAME_RE.test('neo')).toBe(true)
    expect(PROFILE_NAME_RE.test('neo')).toBe(true)
    expect(WIZARD_NAME_RE.test('neo')).toBe(true)
    expect(WIZARD_NAME_RE.test('neo')).toBe(true)
  })
})

describe('WIZARD_NAME_RE — the tighter rule for new names', () => {
  it.each(['neo', 'hermes-switch', 'a1', 'a'.repeat(40)])(
    'accepts %j',
    (name) => {
      expect(isValidWizardProfileName(name)).toBe(true)
      expect(profileNameError(name, 'wizard')).toBeNull()
    },
  )

  it.each(['a', 'a'.repeat(41), 'a_b', 'My Agent!!', ''])(
    'rejects %j',
    (name) => {
      expect(isValidWizardProfileName(name)).toBe(false)
      expect(profileNameError(name, 'wizard')).not.toBeNull()
    },
  )

  it('is strictly narrower than the canonical rule — wizard names always pass on disk', () => {
    for (const name of ['neo', 'hermes-switch', 'a1', 'a'.repeat(40)]) {
      expect(WIZARD_NAME_RE.test(name)).toBe(true)
      expect(PROFILE_NAME_RE.test(name)).toBe(true)
    }
    // The converse does not hold: underscores are on-disk-legal but not offered.
    expect(PROFILE_NAME_RE.test('a_b')).toBe(true)
    expect(WIZARD_NAME_RE.test('a_b')).toBe(false)
  })

  it('uses the wizard copy verbatim for shape failures', () => {
    expect(profileNameError('a_b', 'wizard')).toBe(WIZARD_NAME_MESSAGE)
    expect(profileNameError('', 'wizard')).toBe(PROFILE_NAME_REQUIRED_MESSAGE)
  })
})

describe('sanitizeProfileName', () => {
  it.each([
    ['My Agent!!', 'my-agent'],
    ['Hermes Switch', 'hermes-switch'],
    ['hermes-switch-copy', 'hermes-switch-copy'],
    ['a_b', 'a-b'],
    ['  spaced  ', 'spaced'],
    ['---leading---', 'leading'],
    ['Multiple   Spaces', 'multiple-spaces'],
    ['UPPER', 'upper'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeProfileName(input)).toBe(expected)
  })

  it('clamps to 40 characters without leaving a trailing hyphen', () => {
    const result = sanitizeProfileName(`${'a'.repeat(39)} tail`)
    expect(result.length).toBeLessThanOrEqual(40)
    expect(result.endsWith('-')).toBe(false)
    expect(result).toBe('a'.repeat(39))
  })

  it('produces wizard-valid output for realistic input', () => {
    for (const input of ['My Agent!!', 'Hermes Switch', 'Research_Bot 2']) {
      expect(isValidWizardProfileName(sanitizeProfileName(input))).toBe(true)
    }
  })

  it('can still produce an invalid name, so callers must re-validate', () => {
    expect(sanitizeProfileName('!!!')).toBe('')
    expect(
      profileNameError(sanitizeProfileName('!!!'), 'wizard'),
    ).not.toBeNull()
  })
})
