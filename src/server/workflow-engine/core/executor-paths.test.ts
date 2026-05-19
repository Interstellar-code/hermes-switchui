import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeWorkflow } from './executor'
import type { WorkflowRun } from '../schemas'

const mocks = vi.hoisted(() => ({
  executeDagWorkflow: vi.fn(),
}))

vi.mock('./dag-executor', () => ({
  executeDagWorkflow: mocks.executeDagWorkflow,
}))

vi.mock('../runtime/git.js', () => ({
  getDefaultBranch: vi.fn(() => Promise.resolve('main')),
  toRepoPath: vi.fn((cwd: string) => cwd),
}))

vi.mock('../runtime/providers.js', () => ({
  isRegisteredProvider: vi.fn(() => true),
  getRegisteredProviders: vi.fn(() => [{ id: 'test-provider' }]),
}))

const tempDirs: Array<string> = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workflow-paths-'))
  tempDirs.push(dir)
  return dir
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('executeWorkflow runtime paths', () => {
  it('stores unregistered run logs and artifacts outside cwd .archon fallback', async () => {
    const cwd = await makeTempDir()
    const run = {
      id: 'run-unregistered-path-test',
      workflow_name: 'path-test',
      conversation_id: 'conv-db-1',
      parent_conversation_id: null,
      codebase_id: null,
      working_path: cwd,
      user_message: 'go',
      status: 'pending',
      current_phase: 'execute',
      metadata: {},
      started_at: new Date().toISOString() as unknown as Date,
      last_activity_at: new Date().toISOString() as unknown as Date,
      last_heartbeat: null,
      completed_at: null,
      error: null,
    } as unknown as WorkflowRun

    const store = {
      getCodebaseEnvVars: vi.fn(() => Promise.resolve({})),
      getCodebase: vi.fn(() => Promise.resolve(null)),
      findResumableRun: vi.fn(() => Promise.resolve(null)),
      getCompletedDagNodeOutputs: vi.fn(() => Promise.resolve(new Map())),
      createWorkflowRun: vi.fn(() => Promise.resolve(run)),
      getActiveWorkflowRunByPath: vi.fn(() => Promise.resolve(null)),
      updateWorkflowRun: vi.fn(() => Promise.resolve(undefined)),
      createWorkflowEvent: vi.fn(() => Promise.resolve(undefined)),
      getWorkflowRun: vi.fn(() =>
        Promise.resolve({ ...run, status: 'completed' }),
      ),
      getWorkflowRunStatus: vi.fn(() => Promise.resolve('completed')),
      failWorkflowRun: vi.fn(() => Promise.resolve(undefined)),
    }
    const platform = {
      sendMessage: vi.fn(() => Promise.resolve(undefined)),
      getPlatformType: vi.fn(() => 'test'),
    }
    const deps = {
      store,
      loadConfig: vi.fn(() =>
        Promise.resolve({
          assistant: 'test-provider',
          assistants: { 'test-provider': { model: 'test-model' } },
          commands: {},
          envVars: {},
        }),
      ),
      getAgentProvider: vi.fn(),
    }
    const workflow = {
      name: 'path-test',
      description: 'path test',
      nodes: [],
      edges: [],
    }

    mocks.executeDagWorkflow.mockResolvedValue('done')

    await expect(
      executeWorkflow(
        deps as never,
        platform as never,
        'conv-platform-1',
        cwd,
        workflow as never,
        'go',
        'conv-db-1',
      ),
    ).resolves.toMatchObject({ success: true, workflowRunId: run.id })

    expect(await pathExists(join(cwd, '.archon'))).toBe(false)
    expect(mocks.executeDagWorkflow).toHaveBeenCalledOnce()
    const artifactsDir = mocks.executeDagWorkflow.mock.calls[0][8] as string
    const logDir = mocks.executeDagWorkflow.mock.calls[0][9] as string
    expect(artifactsDir).toContain(
      join('.hermes', 'switchui', 'runs', 'unregistered', run.id, 'artifacts'),
    )
    expect(logDir).toContain(
      join('.hermes', 'switchui', 'runs', 'unregistered', 'logs'),
    )
    expect(artifactsDir).not.toContain(join(cwd, '.archon'))
    expect(logDir).not.toContain(join(cwd, '.archon'))
  })
})
