import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import { listProjects } from '../../../server/projects-client'
import {
  clearGitStatusCache,
  gitStatusOf,
} from '../../../server/project-git-status'
import { Route } from './git-status'
import type * as FsPromises from 'node:fs/promises'

const hang = vi.hoisted(() => new Set<string>())
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    lstat: ((p: string) =>
      hang.has(p)
        ? new Promise(() => {})
        : actual.lstat(p)) as typeof actual.lstat,
  }
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))
vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../../server/projects-client', () => ({
  listProjects: vi.fn(),
  explicitProjectProfile: (request: Request) =>
    new URL(request.url).searchParams.get('profile') || undefined,
}))

const handlers = (Route as any).options.server.handlers
const mockAuth = vi.mocked(isAuthenticated)
const mockList = vi.mocked(listProjects)

const root = mkdtempSync(path.join(tmpdir(), 'git-status-'))
const repo = path.join(root, 'repo')
const worktree = path.join(root, 'worktree')
const plain = path.join(root, 'plain')
mkdirSync(path.join(repo, '.git'), { recursive: true })
writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n')
mkdirSync(path.join(root, 'wt-gitdir'), { recursive: true })
writeFileSync(path.join(root, 'wt-gitdir', 'HEAD'), `${'abcdef12'.repeat(5)}\n`)
mkdirSync(worktree, { recursive: true })
writeFileSync(path.join(worktree, '.git'), 'gitdir: ../wt-gitdir\n')
mkdirSync(plain, { recursive: true })

afterAll(() => rmSync(root, { recursive: true, force: true }))

const folder = (p: string) => ({
  path: p,
  label: null,
  is_primary: false,
  added_at: 0,
})
const get = (query = '') =>
  handlers.GET({
    request: new Request(
      `http://localhost/api/hermes-projects/git-status${query}`,
    ),
  })

beforeEach(() => {
  vi.clearAllMocks()
  clearGitStatusCache()
  mockAuth.mockReturnValue(true)
  mockList.mockResolvedValue({
    active_id: null,
    projects: [
      { id: 'p_repo', folders: [folder(plain), folder(repo)] },
      { id: 'p_wt', folders: [folder(worktree)] },
      { id: 'p_plain', folders: [folder(plain)] },
      { id: 'p_none', folders: [] },
      { id: 'p_rel', folders: [folder('relative/repo')] },
    ] as never,
  })
})

describe('GET /api/hermes-projects/git-status', () => {
  it('reports git checkouts and their branch per project, from the profile list', async () => {
    const res = await get('?profile=work')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      p_repo: { git: true, branch: 'feature/x' },
      p_wt: { git: true, branch: 'abcdef1' },
      p_plain: { git: false },
    })
    expect(mockList).toHaveBeenCalledWith(true, 'work')
  })

  it('rejects unauthenticated requests and invalid profiles', async () => {
    mockAuth.mockReturnValue(false)
    expect((await get()).status).toBe(401)
    mockAuth.mockReturnValue(true)
    expect((await get('?profile=..%2Fetc')).status).toBe(400)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('caches per path for a minute', async () => {
    await get()
    mkdirSync(path.join(plain, '.git'))
    try {
      expect((await (await get()).json()).p_plain).toEqual({ git: false })
      clearGitStatusCache()
      expect((await (await get()).json()).p_plain).toEqual({ git: true })
    } finally {
      rmSync(path.join(plain, '.git'), { recursive: true })
    }
  })

  it('503s when the projects list is unavailable', async () => {
    mockList.mockRejectedValue(new Error('down'))
    expect((await get()).status).toBe(503)
  })
})

describe('gitStatusOf hardening', () => {
  const repoWith = (name: string, setup: (gitDir: string) => void) => {
    const dir = path.join(root, name)
    mkdirSync(path.join(dir, '.git'), { recursive: true })
    setup(path.join(dir, '.git'))
    return dir
  }

  it('does not follow a symlinked HEAD (e.g. to a huge file)', async () => {
    const big = path.join(root, 'big.txt')
    writeFileSync(big, 'ref: refs/heads/main\n' + 'x'.repeat(10_000))
    const dir = repoWith('sym', (g) => symlinkSync(big, path.join(g, 'HEAD')))
    expect(await gitStatusOf(dir)).toEqual({ git: true })
  })

  it.skipIf(process.platform === 'win32')(
    'never blocks on a FIFO HEAD',
    async () => {
      const dir = repoWith('fifo', (g) =>
        execFileSync('mkfifo', [path.join(g, 'HEAD')]),
      )
      expect(await gitStatusOf(dir)).toEqual({ git: true })
    },
  )

  it('names no branch for a HEAD that is neither a branch ref nor a sha', async () => {
    const dir = repoWith('odd', (g) =>
      writeFileSync(path.join(g, 'HEAD'), 'ref: refs/tags/v1\n'),
    )
    expect(await gitStatusOf(dir)).toEqual({ git: true })
    const long = repoWith('long', (g) =>
      writeFileSync(
        path.join(g, 'HEAD'),
        `ref: refs/heads/${'b'.repeat(300)}\n`,
      ),
    )
    expect(await gitStatusOf(long)).toEqual({ git: true })
  })

  it('gives up on a hung path with unknown, and keeps one probe in flight', async () => {
    const dir = path.join(root, 'hung')
    hang.add(path.join(dir, '.git'))
    expect(await gitStatusOf(dir, 20)).toEqual({ git: false, unknown: true })
    expect(await gitStatusOf(dir, 20)).toEqual({ git: false, unknown: true })
  })

  it('does not follow a gitdir pointer onto /Volumes', async () => {
    const dir = path.join(root, 'wt-volumes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '.git'), 'gitdir: /Volumes/share/x.git\n')
    hang.add('/Volumes/share/x.git/HEAD')
    expect(await gitStatusOf(dir)).toEqual({ git: true })
  })

  it('never probes /Volumes', async () => {
    expect(await gitStatusOf('/Volumes/share/repo')).toEqual({
      git: false,
      unknown: true,
    })
  })
})
