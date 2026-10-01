// Wiki nodes through the real, root-checked readKnowledgePage (no mock):
// pages inside the configured wiki root resolve; anything that escapes it 404s.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Route } from './node'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))
vi.mock('../../../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

type GetHandler = (context: { request: Request }) => Response
const get = (
  Route as unknown as {
    options: { server: { handlers: { GET: GetHandler } } }
  }
).options.server.handlers.GET

async function node(id: string) {
  const res = get({
    request: new Request(
      `http://localhost/api/memory/graph/node?id=${encodeURIComponent(id)}`,
    ),
  })
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

const saved = {
  HERMES_HOME: process.env.HERMES_HOME,
  CLAUDE_HOME: process.env.CLAUDE_HOME,
}
let home: string

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-node-wiki-'))
  const wiki = path.join(home, 'wikis', 'main')
  fs.mkdirSync(path.join(wiki, 'entities'), { recursive: true })
  fs.writeFileSync(
    path.join(wiki, 'entities', 'switchui.md'),
    '---\ntitle: SwitchUI\n---\n# SwitchUI\n\nReal page body.\n',
  )
  // a markdown file outside the wiki root, but inside HERMES_HOME
  fs.writeFileSync(path.join(home, 'secret.md'), '# secret\n')
  fs.writeFileSync(
    path.join(home, 'knowledge-config.json'),
    JSON.stringify({ source: { type: 'local', path: wiki } }),
  )
  process.env.HERMES_HOME = home
  delete process.env.CLAUDE_HOME
})

afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  fs.rmSync(home, { recursive: true, force: true })
})

describe('GET /api/memory/graph/node — wiki root check', () => {
  it('reads a page inside the wiki root', async () => {
    const { status, body } = await node('entities/switchui.md')
    expect(status).toBe(200)
    expect(body).toMatchObject({ kind: 'wiki', label: 'SwitchUI' })
    expect(body.text).toContain('Real page body.')
  })

  it('404s for paths that escape the wiki root', async () => {
    for (const id of ['../../secret.md', '../secret.md', `${home}/secret.md`]) {
      const { status, body } = await node(id)
      expect(status, id).toBe(404)
      expect(JSON.stringify(body)).not.toContain('secret')
    }
  })
})
