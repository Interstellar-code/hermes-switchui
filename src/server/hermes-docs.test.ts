import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HermesDocsPathError,
  hermesDocsLiveUrl,
  readHermesDoc,
  resolveHermesDocPath,
  resolveHermesDocsRoot,
} from './hermes-docs'

let docsRoot: string
let outsideDir: string

beforeEach(() => {
  docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-docs-root-'))
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-docs-outside-'))

  fs.mkdirSync(path.join(docsRoot, 'user-guide'), { recursive: true })
  fs.writeFileSync(
    path.join(docsRoot, 'user-guide', 'multi-profile-gateways.md'),
    '# Multiplexing\n\nOne gateway, several profiles.\n',
  )
  fs.writeFileSync(path.join(docsRoot, 'index.mdx'), '# Hermes Agent\n')

  // A secret file OUTSIDE the docs root, plus a symlink inside the root that
  // points at it — the exact escape a naive prefix check misses.
  fs.writeFileSync(path.join(outsideDir, 'secret.md'), '# secret\n')
  fs.symlinkSync(
    path.join(outsideDir, 'secret.md'),
    path.join(docsRoot, 'escape-link.md'),
  )
  // A symlinked directory escape as well.
  fs.symlinkSync(outsideDir, path.join(docsRoot, 'escape-dir'))
  fs.writeFileSync(path.join(outsideDir, 'inner.md'), '# inner\n')
})

afterEach(() => {
  fs.rmSync(docsRoot, { recursive: true, force: true })
  fs.rmSync(outsideDir, { recursive: true, force: true })
})

describe('resolveHermesDocsRoot', () => {
  it('honors the HERMES_DOCS_ROOT override', () => {
    const root = resolveHermesDocsRoot({ HERMES_DOCS_ROOT: '/custom/docs' })
    expect(root).toBe('/custom/docs')
  })

  it('falls back to null when no agent install can be found', () => {
    const root = resolveHermesDocsRoot({
      CLAUDE_AGENT_PATH: path.join(os.tmpdir(), 'definitely-not-installed-xyz'),
      PATH: '',
    })
    expect(root).toBeNull()
  })
})

describe('resolveHermesDocPath — containment', () => {
  it('resolves a normal relative path inside the root', () => {
    const resolved = resolveHermesDocPath(docsRoot, 'user-guide/multi-profile-gateways.md')
    expect(resolved).toBe(fs.realpathSync(path.join(docsRoot, 'user-guide', 'multi-profile-gateways.md')))
  })

  it('rejects a path containing ..', () => {
    expect(() => resolveHermesDocPath(docsRoot, '../secret.md')).toThrow(HermesDocsPathError)
    expect(() => resolveHermesDocPath(docsRoot, 'user-guide/../../secret.md')).toThrow(HermesDocsPathError)
  })

  it('rejects an absolute path', () => {
    expect(() => resolveHermesDocPath(docsRoot, path.join(outsideDir, 'secret.md'))).toThrow(
      HermesDocsPathError,
    )
    expect(() => resolveHermesDocPath(docsRoot, '/etc/passwd')).toThrow(HermesDocsPathError)
  })

  it('rejects a Windows-style absolute path', () => {
    expect(() => resolveHermesDocPath(docsRoot, 'C:\\secret.md')).toThrow(HermesDocsPathError)
  })

  it('rejects a symlinked FILE that escapes the docs root', () => {
    let caught: unknown
    try {
      resolveHermesDocPath(docsRoot, 'escape-link.md')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HermesDocsPathError)
    expect((caught as HermesDocsPathError).reason).toBe('invalid-path')
  })

  it('rejects a path through a symlinked DIRECTORY that escapes the docs root', () => {
    expect(() => resolveHermesDocPath(docsRoot, 'escape-dir/inner.md')).toThrow(HermesDocsPathError)
  })

  it('rejects non-.md/.mdx extensions', () => {
    fs.writeFileSync(path.join(docsRoot, 'notes.txt'), 'hi')
    expect(() => resolveHermesDocPath(docsRoot, 'notes.txt')).toThrow(HermesDocsPathError)
  })

  it('rejects a missing file', () => {
    let caught: unknown
    try {
      resolveHermesDocPath(docsRoot, 'nope.md')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(HermesDocsPathError)
    expect((caught as HermesDocsPathError).reason).toBe('not-found')
  })

  it('resolves .mdx files too', () => {
    const resolved = resolveHermesDocPath(docsRoot, 'index.mdx')
    expect(resolved).toBe(fs.realpathSync(path.join(docsRoot, 'index.mdx')))
  })
})

describe('readHermesDoc', () => {
  it('reads a valid doc and returns a root-relative path', () => {
    const result = readHermesDoc('user-guide/multi-profile-gateways.md', {
      HERMES_DOCS_ROOT: docsRoot,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toContain('One gateway, several profiles')
      expect(result.path).toBe('user-guide/multi-profile-gateways.md')
    }
  })

  it('degrades gracefully when the docs directory is absent', () => {
    const missingRoot = path.join(os.tmpdir(), 'hermes-docs-missing-' + Date.now())
    const result = readHermesDoc('user-guide/multi-profile-gateways.md', {
      HERMES_DOCS_ROOT: missingRoot,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('no-docs-root')
    }
  })

  it('reports invalid-path for traversal attempts without throwing', () => {
    const result = readHermesDoc('../../etc/passwd', { HERMES_DOCS_ROOT: docsRoot })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-path')
    }
  })

  it('reports invalid-path for a symlink escape without throwing', () => {
    const result = readHermesDoc('escape-link.md', { HERMES_DOCS_ROOT: docsRoot })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-path')
    }
  })
})

describe('hermesDocsLiveUrl', () => {
  it('builds a live-site URL from a relative doc path', () => {
    expect(hermesDocsLiveUrl('user-guide/multi-profile-gateways.md')).toBe(
      'https://hermes-agent.nousresearch.com/docs/user-guide/multi-profile-gateways',
    )
  })

  it('strips index and leading slashes', () => {
    expect(hermesDocsLiveUrl('/getting-started/index.mdx')).toBe(
      'https://hermes-agent.nousresearch.com/docs/getting-started',
    )
  })
})
