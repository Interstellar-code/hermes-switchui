import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveMemoryFilePath } from '../memory-browser'
import {
  isAllowedLocalKnowledgePath,
  writeKnowledgeBaseConfig,
} from '../knowledge-config'
import { syncKnowledgeSource } from '../knowledge-browser'
import { isWithinRealRoot } from '../path-containment'

// Real filesystem (no mocks): symlink escapes only show up against real
// realpath() behaviour.

let tmp: string
let home: string
let outside: string
const savedEnv = { ...process.env }

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-sec-')))
  home = path.join(tmp, 'hermes')
  outside = path.join(tmp, 'outside')
  fs.mkdirSync(path.join(home, 'memory'), { recursive: true })
  fs.mkdirSync(path.join(home, 'profiles', 'neo'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(home, 'MEMORY.md'), 'root')
  fs.writeFileSync(path.join(home, 'profiles', 'neo', 'SOUL.md'), 'soul')
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret')
  process.env.HERMES_HOME = home
  delete process.env.CLAUDE_HOME
  delete process.env.WIKI_PATH
  delete process.env.KNOWLEDGE_DIR
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  process.env = { ...savedEnv }
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('resolveMemoryFilePath', () => {
  it('allows MEMORY.md and memory/ files, including not-yet-existing ones', () => {
    expect(resolveMemoryFilePath('MEMORY.md').fullPath).toBe(
      path.join(home, 'MEMORY.md'),
    )
    expect(resolveMemoryFilePath('memory/new/2026-10-01.md').fullPath).toBe(
      path.join(home, 'memory', 'new', '2026-10-01.md'),
    )
  })

  it('rejects non-memory files under HERMES_HOME (SOUL.md, skills)', () => {
    expect(() => resolveMemoryFilePath('profiles/neo/SOUL.md')).toThrow(
      /not a memory file/,
    )
    expect(() => resolveMemoryFilePath('skills/x/SKILL.md')).toThrow(
      /not a memory file/,
    )
  })

  it('rejects traversal, absolute and non-.md paths', () => {
    expect(() =>
      resolveMemoryFilePath('memory/../profiles/neo/SOUL.md'),
    ).toThrow(/traversal/)
    expect(() =>
      resolveMemoryFilePath(path.join(outside, 'secret.md')),
    ).toThrow(/Absolute/)
    expect(() => resolveMemoryFilePath('memory/notes.txt')).toThrow(/Markdown/)
  })

  it('rejects a sibling-prefix dir (memory-evil is not memory/)', () => {
    fs.mkdirSync(path.join(home, 'memory-evil'))
    expect(() => resolveMemoryFilePath('memory-evil/x.md')).toThrow(
      /not a memory file/,
    )
  })

  it('rejects a symlinked dir that escapes the root', () => {
    fs.symlinkSync(outside, path.join(home, 'memory', 'link'))
    expect(() => resolveMemoryFilePath('memory/link/secret.md')).toThrow(
      /outside workspace/,
    )
    // write target that doesn't exist yet, under the escaping symlink
    expect(() => resolveMemoryFilePath('memory/link/new.md')).toThrow(
      /outside workspace/,
    )
  })

  it('rejects a symlinked file and a dangling symlink', () => {
    fs.symlinkSync(
      path.join(outside, 'secret.md'),
      path.join(home, 'memory', 'evil.md'),
    )
    fs.symlinkSync(
      path.join(outside, 'nope.md'),
      path.join(home, 'memory', 'dangling.md'),
    )
    expect(() => resolveMemoryFilePath('memory/evil.md')).toThrow(
      /outside workspace/,
    )
    expect(() => resolveMemoryFilePath('memory/dangling.md')).toThrow(
      /outside workspace/,
    )
  })

  it('rejects an in-home symlink from memories/ into skills/', () => {
    fs.mkdirSync(path.join(home, 'memories'))
    fs.mkdirSync(path.join(home, 'skills', 'foo'), { recursive: true })
    fs.writeFileSync(path.join(home, 'skills', 'foo', 'SKILL.md'), 'skill')
    fs.symlinkSync(
      path.join(home, 'skills', 'foo', 'SKILL.md'),
      path.join(home, 'memories', 'x.md'),
    )
    fs.symlinkSync(path.join(home, 'skills'), path.join(home, 'memories', 'sk'))
    expect(() => resolveMemoryFilePath('memories/x.md')).toThrow(
      /outside workspace/,
    )
    expect(() => resolveMemoryFilePath('memories/sk/foo/SKILL.md')).toThrow(
      /outside workspace/,
    )
    expect(() => resolveMemoryFilePath('memories/sk/new.md')).toThrow(
      /outside workspace/,
    )
  })

  it('rejects a symlink to a sibling memory file (final component)', () => {
    fs.writeFileSync(path.join(home, 'memory', 'a.md'), 'a')
    fs.symlinkSync(
      path.join(home, 'memory', 'a.md'),
      path.join(home, 'memory', 'b.md'),
    )
    expect(() => resolveMemoryFilePath('memory/b.md')).toThrow(/symlink/)
  })
})

describe('isWithinRealRoot', () => {
  it('uses a trailing separator (sibling-prefix does not match)', () => {
    fs.mkdirSync(path.join(tmp, 'hermes-evil'))
    expect(isWithinRealRoot(home, path.join(tmp, 'hermes-evil', 'x.md'))).toBe(
      false,
    )
    expect(isWithinRealRoot(home, home)).toBe(true)
  })
})

describe('knowledge wiki source path', () => {
  it('allows dedicated wiki subtrees, including the profile matrix wiki', () => {
    expect(isAllowedLocalKnowledgePath(path.join(home, 'wikis', 'w'))).toBe(
      true,
    )
    expect(
      isAllowedLocalKnowledgePath(
        path.join(home, 'profiles', 'hermes-switch', 'matrix-memory', 'wiki'),
      ),
    ).toBe(true)
  })

  it('rejects HERMES_HOME itself and its non-wiki subtrees', () => {
    for (const p of [
      home,
      path.join(home, 'wiki'),
      path.join(home, 'skills'),
      path.join(home, 'memory'),
      path.join(home, 'memories'),
      path.join(home, 'profiles', 'neo'),
      path.join(home, 'profiles', 'neo', 'matrix-memory'),
    ]) {
      expect(isAllowedLocalKnowledgePath(p), p).toBe(false)
    }
  })

  it('rejects paths outside, sibling-prefix and symlink escapes', () => {
    expect(isAllowedLocalKnowledgePath(outside)).toBe(false)
    expect(isAllowedLocalKnowledgePath(`${home}-evil/wiki`)).toBe(false)
    expect(
      isAllowedLocalKnowledgePath(path.join(home, 'wikis', '..', 'skills')),
    ).toBe(false)
    fs.mkdirSync(path.join(home, 'wikis'))
    fs.symlinkSync(outside, path.join(home, 'wikis', 'out'))
    fs.mkdirSync(path.join(home, 'skills'))
    fs.symlinkSync(path.join(home, 'skills'), path.join(home, 'wikis', 'sk'))
    expect(isAllowedLocalKnowledgePath(path.join(home, 'wikis', 'out'))).toBe(
      false,
    )
    expect(isAllowedLocalKnowledgePath(path.join(home, 'wikis', 'sk'))).toBe(
      false,
    )
  })

  it('writeKnowledgeBaseConfig refuses a disallowed local path', () => {
    expect(() =>
      writeKnowledgeBaseConfig({ source: { type: 'local', path: home } }),
    ).toThrow(/not allowed/)
    expect(fs.existsSync(path.join(home, 'knowledge-config.json'))).toBe(false)
    writeKnowledgeBaseConfig({
      source: { type: 'local', path: path.join(home, 'wikis', 'w') },
    })
    expect(fs.existsSync(path.join(home, 'knowledge-config.json'))).toBe(true)
  })
})

describe('GitHub sync entry hardening', () => {
  it('skips bad entry names, mirrors nested paths, encodes URLs', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(tmp)
    writeKnowledgeBaseConfig({
      source: { type: 'github', repo: 'o/r', branch: 'feat/x', path: 'docs' },
    })
    const urls: Array<string> = []
    const json = (body: unknown) =>
      Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    const file = (p: string) => ({
      type: 'file',
      name: p.split('/').pop(),
      path: p,
      sha: 's',
    })
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url)
      const u = decodeURIComponent(new URL(url).pathname)
      if (u.endsWith('/contents/docs'))
        return json([
          file('docs/top.md'),
          { type: 'file', name: '..', path: 'docs/..', sha: 's' },
          { type: 'file', name: '', path: 'docs/', sha: 's' },
          { type: 'file', name: 'a/b.md', path: 'docs/a/b.md', sha: 's' },
          { type: 'file', name: 'evil.md', path: '../../evil.md', sha: 's' },
          { type: 'dir', name: 'a', path: 'docs/a', sha: 's' },
          { type: 'dir', name: 'b', path: 'docs/b', sha: 's' },
        ])
      if (u.endsWith('/contents/docs/a')) return json([file('docs/a/x.md')])
      if (u.endsWith('/contents/docs/b')) return json([file('docs/b/x.md')])
      return json({
        content: Buffer.from(u).toString('base64'),
        encoding: 'base64',
      })
    })
    const result = await syncKnowledgeSource()
    expect(result.success).toBe(true)
    const cache = path.join(
      tmp,
      '.claude',
      'knowledge-cache',
      'github',
      'o_r',
      'feat',
      'x',
      'docs',
    )
    const listed = (
      fs.readdirSync(cache, { recursive: true }) as Array<string>
    ).sort()
    expect(listed).toEqual(['a', 'a/x.md', 'b', 'b/x.md', 'top.md'])
    expect(fs.existsSync(path.join(tmp, 'evil.md'))).toBe(false)
    expect(urls.every((u) => u.includes('ref=feat%2Fx'))).toBe(true)
  })
})
