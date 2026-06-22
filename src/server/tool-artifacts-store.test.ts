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
