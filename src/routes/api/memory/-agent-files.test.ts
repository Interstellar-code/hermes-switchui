import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from './agent-files'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

type GetHandler = (context: { request: Request }) => Response

const get = (
  Route as unknown as {
    options: { server: { handlers: { GET: GetHandler } } }
  }
).options.server.handlers.GET

let hermesHome: string

beforeEach(() => {
  hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-agent-files-'))
  process.env.HERMES_HOME = hermesHome
})

afterEach(() => {
  delete process.env.HERMES_HOME
  fs.rmSync(hermesHome, { recursive: true, force: true })
})

describe('GET /api/memory/agent-files', () => {
  it('lists SOUL plus the active profile memory stores as tabs', async () => {
    const profile = path.join(hermesHome, 'profiles', 'hermes-switch')
    fs.mkdirSync(path.join(profile, 'memories'), { recursive: true })
    fs.writeFileSync(path.join(hermesHome, 'SOUL.md'), 'wrong global soul')
    fs.writeFileSync(path.join(profile, 'SOUL.md'), 'profile soul')
    fs.writeFileSync(path.join(profile, 'USER.md'), 'stale user stub')
    fs.writeFileSync(
      path.join(profile, 'memories', 'MEMORY.md'),
      'active memory',
    )
    fs.writeFileSync(
      path.join(profile, 'memories', 'USER.md'),
      'active user profile',
    )

    const response = get({
      request: new Request(
        'http://localhost/api/memory/agent-files?agent=hermes-switch',
      ),
    })
    const body = (await response.json()) as {
      files: Array<{ filename: string }>
    }

    expect(body.files.map((file) => file.filename)).toEqual([
      'SOUL.md',
      'MEMORY.md',
      'USER.md',
    ])

    const soulResponse = get({
      request: new Request(
        'http://localhost/api/memory/agent-files?agent=hermes-switch&filename=SOUL.md',
      ),
    })
    await expect(soulResponse.json()).resolves.toMatchObject({
      content: 'profile soul',
    })

    const userResponse = get({
      request: new Request(
        'http://localhost/api/memory/agent-files?agent=hermes-switch&filename=USER.md',
      ),
    })
    await expect(userResponse.json()).resolves.toMatchObject({
      content: 'active user profile',
    })
  })
})
