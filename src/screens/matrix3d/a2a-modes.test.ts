import { describe, expect, it } from 'vitest'
import {
  a2aMessageKind,
  a2aMessageLabel,
  modeAccent,
  modeLabel,
  normalizeMode,
} from './a2a-modes'
import type { A2AFleetMessage } from '@/lib/hermes-client'

describe('a2a-modes registry', () => {
  it('labels the four known managed modes', () => {
    expect(modeLabel('claude_code')).toBe('Claude Code')
    expect(modeLabel('opencode')).toBe('OpenCode')
    expect(modeLabel('codex')).toBe('Codex')
    expect(modeLabel('agy')).toBe('Antigravity')
  })

  it('titleizes an unknown mode so a new backend mode needs no FE change', () => {
    expect(modeLabel('gemini_cli')).toBe('Gemini Cli')
    expect(modeLabel('foo-bar')).toBe('Foo Bar')
  })

  it('handles empty/nullish modes', () => {
    expect(modeLabel(null)).toBe('Unknown')
    expect(modeLabel('')).toBe('Unknown')
    expect(modeLabel('  ')).toBe('Unknown')
  })

  it('normalizes mode casing/whitespace', () => {
    expect(normalizeMode('  Codex ')).toBe('codex')
    expect(normalizeMode(null)).toBe('')
  })

  it('gives known modes curated accents', () => {
    expect(modeAccent('claude_code')).toBe('#00ff41')
    expect(modeAccent('codex')).toBe('#ff9d3d')
  })

  it('gives unknown modes a stable, deterministic accent', () => {
    const first = modeAccent('gemini_cli')
    const second = modeAccent('gemini_cli')
    expect(first).toBe(second)
    expect(first).toMatch(/^hsl\(\d+ 78% 64%\)$/)
  })

  it('falls back to a neutral accent when no mode is present', () => {
    expect(modeAccent(null)).toBe('var(--m-text-ghost)')
  })
})

describe('a2aMessageKind direction classifier', () => {
  // Every managed mode's orchestrator dir → 'orchestrator'.
  it.each([
    'hermes->claude',
    'hermes->codex',
    'hermes->agy',
    'hermes->opencode',
    'hermes->gemini_cli', // unknown future mode still routes by shape
  ])('classifies %s as orchestrator', (dir) => {
    expect(a2aMessageKind(dir)).toBe('orchestrator')
  })

  // Every managed mode's executor→hermes dir → 'executor'.
  it.each(['claude->hermes', 'codex->hermes', 'agy->hermes', 'opencode->hermes'])(
    'classifies %s as executor',
    (dir) => {
      expect(a2aMessageKind(dir)).toBe('executor')
    },
  )

  // Any ack-tagged dir → 'ack', regardless of mode.
  it.each([
    'claude->hermes (ack)',
    'codex->hermes (ack)',
    'agy->hermes (ack)',
  ])('classifies %s as ack', (dir) => {
    expect(a2aMessageKind(dir)).toBe('ack')
  })

  it('is case-insensitive and tolerates empty input', () => {
    expect(a2aMessageKind('HERMES->CODEX')).toBe('orchestrator')
    expect(a2aMessageKind('CODEX->HERMES (ACK)')).toBe('ack')
    expect(a2aMessageKind('')).toBe('executor')
  })
})

describe('a2aMessageLabel', () => {
  const msg = (dir: string, from = ''): A2AFleetMessage => ({
    ts: null,
    dir,
    from,
    to: '',
    text: '',
  })

  it('labels orchestrator messages with the sender or Hermes', () => {
    expect(a2aMessageLabel(msg('hermes->codex', 'Hermes'), 'codex')).toBe(
      'Hermes',
    )
    expect(a2aMessageLabel(msg('hermes->codex'), 'codex')).toBe('Hermes')
  })

  it('labels ack messages as [queued]', () => {
    expect(a2aMessageLabel(msg('codex->hermes (ack)'), 'codex')).toBe('[queued]')
  })

  it('labels executor messages by mode when no explicit sender', () => {
    expect(a2aMessageLabel(msg('codex->hermes'), 'codex')).toBe('Codex')
    expect(a2aMessageLabel(msg('agy->hermes'), 'agy')).toBe('Antigravity')
    expect(a2aMessageLabel(msg('x->hermes'), 'gemini_cli')).toBe('Gemini Cli')
  })

  it('prefers an explicit sender over the mode label', () => {
    expect(a2aMessageLabel(msg('codex->hermes', 'codex-rescue'), 'codex')).toBe(
      'codex-rescue',
    )
  })
})
