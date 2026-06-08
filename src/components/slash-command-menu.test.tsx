import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SLASH_COMMANDS,
  slashCommandMatches,
  type SlashCommandDefinition,
} from './slash-command-menu'

describe('DEFAULT_SLASH_COMMANDS', () => {
  it('includes /plugins in the slash autocomplete list', () => {
    const plugin = DEFAULT_SLASH_COMMANDS.find(
      (item) => item.command === '/plugins',
    )

    expect(plugin).toBeTruthy()
    expect(plugin?.description).toBe('List installed plugins and their status')
  })

  it('exposes the core slash commands users expect', () => {
    const commands = DEFAULT_SLASH_COMMANDS.map((entry) => entry.command)
    for (const required of [
      '/new',
      '/clear',
      '/model',
      '/save',
      '/skills',
      '/plugins',
      '/skin',
      '/help',
    ]) {
      expect(commands).toContain(required)
    }
  })

  it('defines a non-empty description for every entry', () => {
    for (const entry of DEFAULT_SLASH_COMMANDS) {
      expect(entry.command.startsWith('/')).toBe(true)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('does not duplicate any command label', () => {
    const seen = new Set<string>()
    for (const entry of DEFAULT_SLASH_COMMANDS) {
      expect(seen.has(entry.command)).toBe(false)
      seen.add(entry.command)
    }
  })

  it('marks all default commands as builtin source', () => {
    for (const entry of DEFAULT_SLASH_COMMANDS) {
      expect(entry.source).toBe('builtin')
    }
  })
})

describe('slashCommandMatches', () => {
  const builtin: SlashCommandDefinition = {
    command: '/new',
    description: 'Start new session',
    source: 'builtin',
  }
  const userCmd: SlashCommandDefinition = {
    command: '/my-custom',
    description: 'My custom command',
    source: 'user',
  }

  it('matches when query is empty', () => {
    expect(slashCommandMatches(builtin, '')).toBe(true)
    expect(slashCommandMatches(userCmd, '')).toBe(true)
  })

  it('matches by command name', () => {
    expect(slashCommandMatches(builtin, 'new')).toBe(true)
    expect(slashCommandMatches(userCmd, 'my-custom')).toBe(true)
  })

  it('matches by description substring', () => {
    expect(slashCommandMatches(builtin, 'session')).toBe(true)
  })

  it('matches by source label', () => {
    expect(slashCommandMatches(builtin, 'builtin')).toBe(true)
    expect(slashCommandMatches(userCmd, 'user')).toBe(true)
  })

  it('normalizes diacritics and case', () => {
    expect(slashCommandMatches(builtin, 'NEW')).toBe(true)
  })

  it('returns false for non-matching query', () => {
    expect(slashCommandMatches(builtin, 'nothing')).toBe(false)
  })
})
