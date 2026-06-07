import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetCommandsStoreForTests,
  createUserCommand,
  deleteUserCommand,
  listUserCommands,
  updateUserCommand,
} from './commands-store'
import { __resetSwitchUiDbForTests, getSwitchUiDbPath } from './switchui-db'

let tempHome: string
let originalHermesHome: string | undefined
let originalSwitchUiDbPath: string | undefined

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'switchui-commands-'))
  originalHermesHome = process.env.HERMES_HOME
  originalSwitchUiDbPath = process.env.SWITCHUI_DB_PATH
  process.env.HERMES_HOME = tempHome
  delete process.env.SWITCHUI_DB_PATH
  __resetSwitchUiDbForTests()
})

afterEach(() => {
  __resetSwitchUiDbForTests()
  if (originalHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHermesHome
  if (originalSwitchUiDbPath === undefined) delete process.env.SWITCHUI_DB_PATH
  else process.env.SWITCHUI_DB_PATH = originalSwitchUiDbPath
  rmSync(tempHome, { recursive: true, force: true })
})

describe('commands-store', () => {
  it('stores commands in the SwitchUI sqlite database', () => {
    expect(getSwitchUiDbPath()).toBe(join(tempHome, 'switchui.db'))
    const created = createUserCommand({
      name: 'Review',
      slash: '/review',
      description: 'Review the current message',
      prompt: 'Review this carefully.',
    })

    expect(created.id).toMatch(/^cmd_/)
    expect(created.enabled).toBe(true)
    expect(listUserCommands().map((command) => command.slash)).toEqual([
      '/review',
    ])
  })

  it('persists commands after the database connection is reopened', () => {
    createUserCommand({ slash: '/persist', prompt: 'Persist this.' })
    __resetSwitchUiDbForTests()
    expect(listUserCommands().map((command) => command.slash)).toEqual([
      '/persist',
    ])
  })

  it('normalizes missing leading slash and rejects duplicate slashes', () => {
    createUserCommand({ slash: 'summarize', prompt: 'Summarize this.' })
    expect(listUserCommands()[0].slash).toBe('/summarize')

    expect(() =>
      createUserCommand({ slash: '/summarize', prompt: 'Duplicate' }),
    ).toThrow(/already exists/i)
  })

  it('rejects reserved built-in commands', () => {
    expect(() =>
      createUserCommand({ slash: '/new', prompt: 'Not allowed' }),
    ).toThrow(/reserved/i)
  })

  it('updates and deletes commands', () => {
    const created = createUserCommand({
      slash: '/review',
      prompt: 'Review this.',
    })

    const updated = updateUserCommand(created.id, {
      name: 'Deep Review',
      slash: '/deep-review',
      enabled: false,
    })
    expect(updated.name).toBe('Deep Review')
    expect(updated.slash).toBe('/deep-review')
    expect(updated.enabled).toBe(false)

    expect(deleteUserCommand(created.id)).toBe(true)
    expect(listUserCommands()).toEqual([])
  })

  it('can reset table contents for tests', () => {
    createUserCommand({ slash: '/one', prompt: 'One' })
    __resetCommandsStoreForTests()
    expect(listUserCommands()).toEqual([])
  })
})
