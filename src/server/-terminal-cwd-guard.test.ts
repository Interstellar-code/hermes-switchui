import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertAllowedCwd, getAllowedCwdRoots } from './terminal-cwd-guard'

const home = os.homedir()

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAllowedCwdRoots', () => {
  it('always includes the home directory', () => {
    const roots = getAllowedCwdRoots()
    expect(roots).toContain(home)
  })

  it('includes extra roots from TERMINAL_ALLOWED_CWD_ROOTS', () => {
    vi.stubEnv('TERMINAL_ALLOWED_CWD_ROOTS', '/opt/workspace:/srv/data')
    const roots = getAllowedCwdRoots()
    expect(roots).toContain('/opt/workspace')
    expect(roots).toContain('/srv/data')
  })
})

describe('assertAllowedCwd — acceptance', () => {
  it('accepts a path directly equal to home', () => {
    const result = assertAllowedCwd(home)
    expect(result).toBe(path.resolve(home))
  })

  it('accepts a subdirectory of home', () => {
    const sub = path.join(home, 'projects', 'myapp')
    const result = assertAllowedCwd(sub)
    expect(result).toBe(path.resolve(sub))
  })

  it('accepts a ~ path that expands into home', () => {
    vi.stubEnv('HOME', home)
    const result = assertAllowedCwd('~/projects')
    expect(result).toBe(path.resolve(home, 'projects'))
  })

  it('accepts a path inside an operator-supplied extra root', () => {
    const extra = '/tmp/allowed-workspace'
    const result = assertAllowedCwd(path.join(extra, 'sub'), [extra])
    expect(result).toBe(path.resolve(extra, 'sub'))
  })
})

describe('assertAllowedCwd — rejection', () => {
  it('rejects an absolute path outside home (/etc/passwd)', () => {
    expect(() => assertAllowedCwd('/etc/passwd', [home])).toThrowError()
    expect(() => assertAllowedCwd('/etc/passwd', [home])).toThrow(/CWD_NOT_ALLOWED|outside the allowed/)
  })

  it('rejects /etc by itself', () => {
    expect(() => assertAllowedCwd('/etc', [home])).toThrowError()
  })

  it('rejects traversal: ../../etc from a sub-path', () => {
    // Even though it starts below home, resolving collapses it to /etc
    const traversal = path.join(home, 'projects', '../../..', 'etc')
    expect(() => assertAllowedCwd(traversal, [home])).toThrowError()
  })

  it('rejects ~ path that resolves outside home via extra ..', () => {
    vi.stubEnv('HOME', home)
    // ~/../../etc resolves to /etc after collapse
    expect(() => assertAllowedCwd('~/../../etc', [home])).toThrowError()
  })

  it('rejects a path that merely starts with the home prefix but is not inside it', () => {
    // e.g. home=/home/user but path=/home/user-evil
    const fakeRoot = '/home/user'
    const evil = '/home/user-evil/secrets'
    expect(() => assertAllowedCwd(evil, [fakeRoot])).toThrowError()
  })

  it('attaches code CWD_NOT_ALLOWED to the thrown error', () => {
    let caught: unknown
    try {
      assertAllowedCwd('/etc', [home])
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as NodeJS.ErrnoException).code).toBe('CWD_NOT_ALLOWED')
  })
})
