/**
 * /api/knowledge/search (auth, matching, containment), /read (raw +
 * frontmatter, profile), /write conflicts (mtime 409, createOnly 409).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route as ListRoute } from './list'
import { Route as ReadRoute } from './read'
import { Route as SearchRoute } from './search'
import { Route as WriteRoute } from './write'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (options: unknown) => ({ options }),
}))

const auth = vi.hoisted(() => ({ ok: true }))
vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => auth.ok,
}))

type Handler = (ctx: { request: Request }) => Response | Promise<Response>
const handlers = (route: unknown) =>
  (route as { options: { server: { handlers: Record<string, Handler> } } })
    .options.server.handlers

type Hit = { path: string; title: string; line: number; text: string }

async function search(q: string) {
  const res = await handlers(SearchRoute).GET({
    request: new Request(
      `http://localhost/api/knowledge/search?q=${encodeURIComponent(q)}`,
    ),
  })
  const body = (await res.json()) as { results?: Array<Hit>; error?: string }
  return { status: res.status, body }
}

async function write(body: Record<string, unknown>) {
  const res = await handlers(WriteRoute).POST({
    request: new Request('http://localhost/api/knowledge/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  return {
    status: res.status,
    body: (await res.json()) as {
      page?: { modified: string }
      conflict?: boolean
      error?: string
    },
  }
}

async function read(qs: string) {
  const res = await handlers(ReadRoute).GET({
    request: new Request(`http://localhost/api/knowledge/read?${qs}`),
  })
  return {
    status: res.status,
    body: (await res.json()) as {
      content?: string
      raw?: string
      page?: { title: string; tags: Array<string>; modified: string }
      links?: Record<string, string | null>
      error?: string
    },
  }
}

const originalEnv = { ...process.env }
let tempRoot = ''
let wiki = ''

function put(rel: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(wiki, rel)), { recursive: true })
  fs.writeFileSync(path.join(wiki, rel), content)
}

beforeEach(() => {
  auth.ok = true
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-wiki-routes-'))
  wiki = path.join(tempRoot, 'wikis', 'wiki')
  fs.mkdirSync(wiki, { recursive: true })
  process.env = { ...originalEnv, HERMES_HOME: tempRoot }
  fs.writeFileSync(
    path.join(tempRoot, 'knowledge-config.json'),
    JSON.stringify({ source: { type: 'local', path: wiki } }),
  )
  put(
    'concepts/alpha.md',
    '---\ntitle: Alpha Notes\n---\n# Alpha\nnothing here\n',
  )
  put('concepts/beta.md', '# Beta\nThe quick brown fox mentions alpha too.\n')
  put('raw/ingest.md', 'alpha raw dump\n')
})

afterEach(() => {
  process.env = { ...originalEnv }
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

describe('GET /api/knowledge/search', () => {
  it('401 when unauthenticated', async () => {
    auth.ok = false
    expect((await search('alpha')).status).toBe(401)
  })

  it('matches titles before bodies, case-insensitive, excludes raw/', async () => {
    const { status, body } = await search('ALPHA')
    expect(status).toBe(200)
    expect(body.results!.map((r) => r.path)).toEqual([
      'concepts/alpha.md',
      'concepts/beta.md',
    ])
    expect(body.results![1].text).toBe(
      'The quick brown fox mentions alpha too.',
    )
  })

  it('requires every term', async () => {
    const { body } = await search('brown alpha')
    expect(body.results!.map((r) => r.path)).toEqual(['concepts/beta.md'])
    expect((await search('brown zebra')).body.results).toEqual([])
  })

  it('treats traversal-looking queries as plain text and never leaves the root', async () => {
    const outside = path.join(tempRoot, 'secret.md')
    fs.writeFileSync(outside, 'alpha secret outside the wiki\n')
    fs.symlinkSync(outside, path.join(wiki, 'concepts', 'leak.md'))

    expect((await search('../secret')).body.results).toEqual([])
    const paths = (await search('secret')).body.results!.map((r) => r.path)
    expect(paths).toEqual([])
  })
})

describe('POST /api/knowledge/write conflict check', () => {
  it('writes when expectedModified matches, 409 when the file changed since', async () => {
    const first = await write({ path: 'concepts/gamma.md', content: '# v1' })
    expect(first.status).toBe(200)
    // Pin v1's mtime in the past so the next write gets a distinct mtime.
    const past = new Date('2020-01-01T00:00:00.000Z')
    fs.utimesSync(path.join(wiki, 'concepts/gamma.md'), past, past)
    const loaded = past.toISOString()

    const ok = await write({
      path: 'concepts/gamma.md',
      content: '# v2',
      expectedModified: loaded,
    })
    expect(ok.status).toBe(200)

    // Someone else edits the page after our editor loaded `loaded`.
    const stale = await write({
      path: 'concepts/gamma.md',
      content: '# v3 from a stale editor',
      expectedModified: loaded,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.conflict).toBe(true)
    expect(fs.readFileSync(path.join(wiki, 'concepts/gamma.md'), 'utf-8')).toBe(
      '# v2',
    )

    // Overwrite = resend without expectedModified.
    const forced = await write({ path: 'concepts/gamma.md', content: '# v3' })
    expect(forced.status).toBe(200)
  })
})

describe('frontmatter round-trip (read raw → save)', () => {
  it('read returns raw with frontmatter; saving raw keeps title/tags', async () => {
    put('concepts/fm.md', '---\ntitle: Kept Title\ntags: [a, b]\n---\n# Body\n')
    const loaded = await read('path=concepts/fm.md')
    expect(loaded.body.content).not.toContain('title:')
    expect(loaded.body.raw).toContain('title: Kept Title')

    const saved = await write({
      path: 'concepts/fm.md',
      content: loaded.body.raw!.replace('# Body', '# Body edited'),
      expectedModified: loaded.body.page!.modified,
    })
    expect(saved.status).toBe(200)
    const after = await read('path=concepts/fm.md')
    expect(after.body.page!.title).toBe('Kept Title')
    expect(after.body.page!.tags).toEqual(['a', 'b'])
    expect(after.body.content).toContain('# Body edited')
  })
})

describe('createOnly', () => {
  it('409 when the path already exists, file untouched; creates otherwise', async () => {
    const clash = await write({
      path: 'concepts/alpha.md',
      content: '# clobber',
      createOnly: true,
    })
    expect(clash.status).toBe(409)
    expect(clash.body.error).toMatch(/already exists/)
    expect(
      fs.readFileSync(path.join(wiki, 'concepts/alpha.md'), 'utf-8'),
    ).toContain('Alpha Notes')
    const fresh = await write({
      path: 'concepts/new.md',
      content: '# new',
      createOnly: true,
    })
    expect(fresh.status).toBe(200)
  })
})

describe('basename collisions', () => {
  it('[[x]] resolves to the shortest path, then alphabetical', async () => {
    put('zeta/deep/dup.md', '# deep')
    put('b/dup.md', '# b')
    put('a/dup.md', '# a')
    put('concepts/links.md', 'see [[dup]] and [[constructor]]')
    const { body } = await read('path=concepts/links.md')
    expect(body.links).toEqual({ dup: 'a/dup.md', constructor: null })
  })
})

describe('?profile=', () => {
  beforeEach(() => {
    // No configured path → root comes from the profile's matrix-memory wiki.
    fs.writeFileSync(
      path.join(tempRoot, 'knowledge-config.json'),
      JSON.stringify({ source: { type: 'local', path: '' } }),
    )
    delete process.env.WIKI_PATH
    delete process.env.KNOWLEDGE_DIR
    for (const [profile, base] of [
      ['neo', path.join(tempRoot, 'profiles', 'neo')],
      ['default', tempRoot],
    ] as const) {
      const dir = path.join(base, 'matrix-memory', 'wiki')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'who.md'), `# ${profile} wiki\n`)
    }
  })

  it('400 for unknown or malformed profiles on read, search and write', async () => {
    expect((await read('path=who.md&profile=ghost')).status).toBe(400)
    expect((await read('path=who.md&profile=../neo')).body.error).toBe(
      'unknown profile',
    )
    const res = await handlers(SearchRoute).GET({
      request: new Request(
        'http://localhost/api/knowledge/search?q=x&profile=ghost',
      ),
    })
    expect(res.status).toBe(400)
    expect(
      (await write({ path: 'who.md', content: 'x', profile: 'ghost' })).status,
    ).toBe(400)
  })

  it('reads and writes the selected profile wiki', async () => {
    expect((await read('path=who.md&profile=neo')).body.content).toContain(
      'neo wiki',
    )
    expect((await read('path=who.md&profile=default')).body.content).toContain(
      'default wiki',
    )
    const w = await write({ path: 'n.md', content: '# n', profile: 'neo' })
    expect(w.status).toBe(200)
    expect(
      fs.existsSync(
        path.join(tempRoot, 'profiles', 'neo', 'matrix-memory', 'wiki', 'n.md'),
      ),
    ).toBe(true)
  })
})

describe('profile vs configured path (M1)', () => {
  it('config path set + profile=neo → list/read/write hit neo, not the config path', async () => {
    const neoWiki = path.join(
      tempRoot,
      'profiles',
      'neo',
      'matrix-memory',
      'wiki',
    )
    fs.mkdirSync(neoWiki, { recursive: true })
    fs.writeFileSync(path.join(neoWiki, 'neo-only.md'), '# neo only\n')

    const res = await handlers(ListRoute).GET({
      request: new Request('http://localhost/api/knowledge/list?profile=neo'),
    })
    const listed = (await res.json()) as { pages: Array<{ path: string }> }
    expect(listed.pages.map((p) => p.path)).toEqual(['neo-only.md'])

    expect((await read('path=neo-only.md&profile=neo')).status).toBe(200)
    expect((await read('path=concepts/alpha.md&profile=neo')).status).toBe(404)
    // Absent profile still reads the configured path.
    expect((await read('path=concepts/alpha.md')).status).toBe(200)

    expect(
      (await write({ path: 'w.md', content: '# w', profile: 'neo' })).status,
    ).toBe(200)
    expect(fs.existsSync(path.join(neoWiki, 'w.md'))).toBe(true)
    expect(fs.existsSync(path.join(wiki, 'w.md'))).toBe(false)
  })
})

describe('symlinked profile wiki (L1)', () => {
  it('rejects writes when $HERMES_HOME/matrix-memory/wiki is a symlink to skills/', async () => {
    fs.writeFileSync(
      path.join(tempRoot, 'knowledge-config.json'),
      JSON.stringify({ source: { type: 'local', path: '' } }),
    )
    const skills = path.join(tempRoot, 'skills')
    fs.mkdirSync(skills, { recursive: true })
    fs.mkdirSync(path.join(tempRoot, 'matrix-memory'), { recursive: true })
    fs.symlinkSync(skills, path.join(tempRoot, 'matrix-memory', 'wiki'))

    const res = await write({
      path: 'SKILL.md',
      content: 'pwned',
      profile: 'default',
    })
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(skills, 'SKILL.md'))).toBe(false)
  })
})

describe('search q length (L3)', () => {
  it('400 when q is longer than 500 chars', async () => {
    expect((await search('a'.repeat(501))).status).toBe(400)
    expect((await search('a'.repeat(500))).status).toBe(200)
  })
})
