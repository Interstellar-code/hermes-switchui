import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOrUpdateToolArtifact,
  externalizeLargeToolOutput,
  getToolArtifact,
} from './tool-artifacts-store'

describe('tool artifact store — atomic writes', () => {
  let tempDir: string
  let origCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-atomic-'))
    origCwd = process.cwd()
    process.chdir(tempDir)
    vi.resetModules()
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('content file round-trips and leaves no .tmp file behind on success', async () => {
    const { createOrUpdateToolArtifact: create, getToolArtifact: get } = await import(
      './tool-artifacts-store'
    )
    const artifact = create({
      sessionId: 'sess-atomic',
      toolName: 'bash',
      content: 'hello atomic world',
    })
    const retrieved = get(artifact.id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.content).toBe('hello atomic world')

    // No leftover .tmp files anywhere under tempDir
    const allFiles = fs.readdirSync(path.join(tempDir, '.runtime', 'tool-artifacts'), {
      recursive: true,
    }) as string[]
    expect(allFiles.filter((f) => String(f).endsWith('.tmp'))).toHaveLength(0)
  })

  it('index file survives a module reload (persisted atomically)', async () => {
    const { createOrUpdateToolArtifact: create } = await import('./tool-artifacts-store')
    create({ sessionId: 'sess-reload', toolName: 'read', content: 'index persistence check' })

    vi.resetModules()
    const { listToolArtifacts } = await import('./tool-artifacts-store')
    const hits = listToolArtifacts('sess-reload')
    expect(hits).toHaveLength(1)
    expect(hits[0].sessionId).toBe('sess-reload')
  })
})

describe('tool-artifacts-store — MAX_ARTIFACTS eviction', () => {
  let tempDir: string
  let origCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-evict-'))
    origCwd = process.cwd()
    process.chdir(tempDir)
    vi.resetModules()
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('keeps the count at or below MAX_ARTIFACTS after inserting past the cap', async () => {
    const { createOrUpdateToolArtifact: create, listToolArtifacts, MAX_ARTIFACTS } =
      await import('./tool-artifacts-store')

    for (let i = 0; i < MAX_ARTIFACTS + 10; i++) {
      create({ sessionId: 'sess-evict', toolName: 'tool', content: `unique-${i}-${Math.random()}` })
    }

    expect(listToolArtifacts().length).toBeLessThanOrEqual(MAX_ARTIFACTS)
  })

  it('evicts the oldest artifacts (lowest createdAt) first', async () => {
    const { createOrUpdateToolArtifact: create, listToolArtifacts, MAX_ARTIFACTS } =
      await import('./tool-artifacts-store')

    const ids: string[] = []
    for (let i = 0; i < MAX_ARTIFACTS + 5; i++) {
      const a = create({ sessionId: 'sess-oldest', toolName: 'tool', content: `old-${i}-${Math.random()}` })
      ids.push(a.id)
    }

    const remaining = new Set(listToolArtifacts().map((a) => a.id))
    // First 5 (oldest) must be evicted.
    for (let i = 0; i < 5; i++) {
      expect(remaining.has(ids[i])).toBe(false)
    }
    // Last MAX_ARTIFACTS must survive.
    for (let i = 5; i < MAX_ARTIFACTS + 5; i++) {
      expect(remaining.has(ids[i])).toBe(true)
    }
  })

  it('deletes the content file of evicted artifacts from disk', async () => {
    const { createOrUpdateToolArtifact: create, MAX_ARTIFACTS } =
      await import('./tool-artifacts-store')

    const first = create({ sessionId: 'sess-fs', toolName: 'tool', content: `first-${Math.random()}` })
    expect(fs.existsSync(first.contentPath)).toBe(true)

    for (let i = 1; i < MAX_ARTIFACTS + 2; i++) {
      create({ sessionId: 'sess-fs', toolName: 'tool', content: `extra-${i}-${Math.random()}` })
    }

    expect(fs.existsSync(first.contentPath)).toBe(false)
  })
})

describe('tool-artifacts-store — deleteSessionArtifacts', () => {
  let tempDir: string
  let origCwd: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-artifacts-del-'))
    origCwd = process.cwd()
    process.chdir(tempDir)
    vi.resetModules()
  })

  afterEach(() => {
    process.chdir(origCwd)
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('removes all artifacts for the target session and leaves others intact', async () => {
    const { createOrUpdateToolArtifact: create, deleteSessionArtifacts, listToolArtifacts } =
      await import('./tool-artifacts-store')

    for (let i = 0; i < 5; i++) {
      create({ sessionId: 'sess-target', toolName: 'tool', content: `target-${i}-${Math.random()}` })
    }
    for (let i = 0; i < 3; i++) {
      create({ sessionId: 'sess-other', toolName: 'tool', content: `other-${i}-${Math.random()}` })
    }

    expect(listToolArtifacts('sess-target').length).toBe(5)
    expect(listToolArtifacts('sess-other').length).toBe(3)

    deleteSessionArtifacts('sess-target')

    expect(listToolArtifacts('sess-target').length).toBe(0)
    expect(listToolArtifacts('sess-other').length).toBe(3)
    expect(listToolArtifacts().length).toBe(3)
    expect(listToolArtifacts().every((a) => a.sessionId === 'sess-other')).toBe(true)
  })

  it('deletes content files for the removed session from disk', async () => {
    const { createOrUpdateToolArtifact: create, deleteSessionArtifacts } =
      await import('./tool-artifacts-store')

    const artifacts = Array.from({ length: 3 }, (_, i) =>
      create({ sessionId: 'sess-del-fs', toolName: 'tool', content: `fs-${i}-${Math.random()}` }),
    )

    for (const a of artifacts) expect(fs.existsSync(a.contentPath)).toBe(true)
    deleteSessionArtifacts('sess-del-fs')
    for (const a of artifacts) expect(fs.existsSync(a.contentPath)).toBe(false)
  })

  it('is a no-op when the session has no artifacts', async () => {
    const { deleteSessionArtifacts, listToolArtifacts } = await import('./tool-artifacts-store')
    expect(() => deleteSessionArtifacts('sess-nonexistent')).not.toThrow()
    expect(listToolArtifacts()).toHaveLength(0)
  })
})

describe('tool artifact store', () => {
  it('stores large tool output and replaces the chat payload with a compact pointer', () => {
    const largeOutput = `header\n${'x'.repeat(4_200)}\ntail`
    const compact = externalizeLargeToolOutput('test-session-artifacts', {
      id: 'msg-large-tool-output',
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read_file',
      content: [{ type: 'text', text: largeOutput }],
      text: largeOutput,
    })

    expect(compact.artifactId).toMatch(/^toolout_/)
    expect(String(compact.text)).toContain('Full output stored as artifact')
    expect(String(compact.text).length).toBeLessThan(largeOutput.length)
    expect(JSON.stringify(compact)).not.toContain('x'.repeat(1_200))

    const artifact = getToolArtifact(String(compact.artifactId))
    expect(artifact?.content).toBe(largeOutput)
    expect(artifact?.toolName).toBe('read_file')
    expect(artifact?.kind).toBe('file_read')
  })

  it('uses stable ids for the same tool output', () => {
    const first = createOrUpdateToolArtifact({
      sessionId: 'test-session-artifacts',
      messageId: 'msg-stable',
      toolName: 'terminal',
      content: 'same terminal log',
    })
    const second = createOrUpdateToolArtifact({
      sessionId: 'test-session-artifacts',
      messageId: 'msg-stable',
      toolName: 'terminal',
      content: 'same terminal log',
    })

    expect(second.id).toBe(first.id)
    expect(second.kind).toBe('terminal_log')
  })
})
