import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  remoteUrlMatches,
  isOnlyTrivialDirty,
  isUpdateAvailable,
  resolveUpdatePresentation,
} from './update-system'

/**
 * Create a temporary git repo with an initial package.json commit.
 */
function createTempRepo(initialVersion = '2.3.27'): string {
  const repo = join(tmpdir(), `test-trivial-dirty-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo, stdio: 'ignore' })
  writeFileSync(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'test', version: initialVersion }, null, 2) + '\n',
  )
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' })
  return repo
}

describe('update-system helpers', () => {
  it('matches GitHub URL forms against expected repo aliases', () => {
    expect(
      remoteUrlMatches('https://github.com/outsourc-e/hermes-workspace.git', [
        'outsourc-e/hermes-workspace',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('git@github.com:NousResearch/hermes-agent.git', [
        'hermes-agent',
      ]),
    ).toBe(true)
    expect(
      remoteUrlMatches('https://github.com/example/other.git', [
        'hermes-switchui',
      ]),
    ).toBe(false)
  })
})

describe('isOnlyTrivialDirty', () => {
  it('returns false when there are no dirty files', () => {
    const repo = createTempRepo()
    try {
      expect(isOnlyTrivialDirty(repo)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns true when only package.json has a version bump', () => {
    const repo = createTempRepo('2.3.27')
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'test', version: '2.3.28' }, null, 2) + '\n',
      )
      expect(isOnlyTrivialDirty(repo)).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns true for a patch version bump (0.1.0 -> 0.1.1)', () => {
    const repo = createTempRepo('0.1.0')
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'test', version: '0.1.1' }, null, 2) + '\n',
      )
      expect(isOnlyTrivialDirty(repo)).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns false when package.json has non-version changes', () => {
    const repo = createTempRepo('2.3.27')
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'renamed', version: '2.3.27' }, null, 2) + '\n',
      )
      expect(isOnlyTrivialDirty(repo)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns false when multiple files are dirty', () => {
    const repo = createTempRepo('2.3.27')
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'test', version: '2.3.28' }, null, 2) + '\n',
      )
      writeFileSync(join(repo, 'extra.txt'), 'hello')
      expect(isOnlyTrivialDirty(repo)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns false when dirty file is not package.json', () => {
    const repo = createTempRepo('2.3.27')
    try {
      writeFileSync(join(repo, 'README.md'), '# Test')
      expect(isOnlyTrivialDirty(repo)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns false when package.json has both version bump and name change', () => {
    const repo = createTempRepo('2.3.27')
    try {
      writeFileSync(
        join(repo, 'package.json'),
        JSON.stringify({ name: 'new-name', version: '2.3.28' }, null, 2) + '\n',
      )
      expect(isOnlyTrivialDirty(repo)).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('returns true when version is the last key without trailing comma', () => {
    const repo = createTempRepo('2.3.27')
    try {
      const pkg = '{\n  "name": "test",\n  "version": "2.3.28"\n}\n'
      writeFileSync(join(repo, 'package.json'), pkg)
      expect(isOnlyTrivialDirty(repo)).toBe(true)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// isUpdateAvailable
// ---------------------------------------------------------------------------

const BASE_HEADS = { currentHead: 'aaa', latestHead: 'bbb' }

describe('isUpdateAvailable', () => {
  it('returns false when supportedBranch is false', () => {
    expect(
      isUpdateAvailable({ supportedBranch: false, ...BASE_HEADS, localBehindRemote: true }),
    ).toBe(false)
  })

  it('returns false when currentHead is null', () => {
    expect(
      isUpdateAvailable({
        supportedBranch: true,
        currentHead: null,
        latestHead: 'bbb',
        localBehindRemote: true,
      }),
    ).toBe(false)
  })

  it('returns false when latestHead is null', () => {
    expect(
      isUpdateAvailable({
        supportedBranch: true,
        currentHead: 'aaa',
        latestHead: null,
        localBehindRemote: true,
      }),
    ).toBe(false)
  })

  it('returns false when heads are equal (already current)', () => {
    expect(
      isUpdateAvailable({
        supportedBranch: true,
        currentHead: 'aaa',
        latestHead: 'aaa',
        localBehindRemote: true,
      }),
    ).toBe(false)
  })

  it('returns false when heads differ but localBehindRemote is false (ahead or diverged)', () => {
    expect(
      isUpdateAvailable({ supportedBranch: true, ...BASE_HEADS, localBehindRemote: false }),
    ).toBe(false)
  })

  it('returns true only when heads differ AND localBehindRemote is true', () => {
    expect(
      isUpdateAvailable({ supportedBranch: true, ...BASE_HEADS, localBehindRemote: true }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveUpdatePresentation
// ---------------------------------------------------------------------------

const LABELS = {
  localChanges: 'local changes msg',
  verifyRef: 'verify ref msg',
  diverged: 'diverged msg',
}

describe('resolveUpdatePresentation', () => {
  it('returns current/null/unblocked when no update is available', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: false,
      dirty: false,
      trivialDirty: false,
      canSync: true,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'current', reason: null, blocked: false })
  })

  it('KEY REGRESSION: dirty checkout with NO update must yield current, not blocked', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: false,
      dirty: true,
      trivialDirty: false,
      canSync: true,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'current', reason: null, blocked: false })
  })

  it('returns blocked/localChanges when update available and dirty (non-trivial)', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: true,
      dirty: true,
      trivialDirty: false,
      canSync: true,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'blocked', reason: 'local changes msg', blocked: true })
  })

  it('does NOT block for trivial dirty (version-only package.json changes)', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: true,
      dirty: true,
      trivialDirty: true,
      canSync: true,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'available', reason: null, blocked: false })
  })

  it('returns blocked/verifyRef when update available and canSync is false', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: true,
      dirty: false,
      trivialDirty: false,
      canSync: false,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'blocked', reason: 'verify ref msg', blocked: true })
  })

  it('returns available/diverged when update available, canSync true, ff false', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: true,
      dirty: false,
      trivialDirty: false,
      canSync: true,
      ff: false,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'available', reason: 'diverged msg', blocked: false })
  })

  it('returns available/null when update available, canSync true, ff true (clean fast-forward)', () => {
    const result = resolveUpdatePresentation({
      updateAvailable: true,
      dirty: false,
      trivialDirty: false,
      canSync: true,
      ff: true,
      labels: LABELS,
    })
    expect(result).toEqual({ state: 'available', reason: null, blocked: false })
  })
})
