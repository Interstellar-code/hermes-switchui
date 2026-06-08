import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { remoteUrlMatches, isOnlyTrivialDirty } from './update-system'

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
