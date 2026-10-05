import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/node-runs-failed-bash.json'
import {
  approvalInfo,
  artifactLabels,
  configText,
  durationMs,
  exitCode,
  fmtWait,
  isAwaitingApproval,
  lastErrorLine,
  selectNode,
  stderrTail,
  timeoutText,
  usageNote,
} from './node-panel-model'
import type { NodeRunRow, WorkflowRunRow } from '@/screens/workflows/api-client'
import type { ParsedWorkflow } from '@/screens/workflows/types'

const parsed = fixture.parsed as unknown as ParsedWorkflow
const nodeRuns = fixture.nodeRuns as unknown as Array<NodeRunRow>
const run = fixture.run as unknown as WorkflowRunRow

describe('selectNode', () => {
  it('resolves run row, neighbours and position', () => {
    const s = selectNode(parsed, nodeRuns, 'approval-gate')
    expect(s.nodeRun?.id).toBe('1d07b3e2-aaaa')
    expect(s.dependsOn).toEqual(['dedup-verify'])
    expect(s.feeds).toEqual(['apply'])
    expect([s.index, s.total]).toEqual([2, 3])
  })

  it('has no run row for a node that was not reached', () => {
    const s = selectNode(parsed, nodeRuns, 'dedup-verify')
    expect(s.nodeRun).toBeNull()
    expect(s.feeds).toEqual(['approval-gate'])
  })

  it('tolerates a missing definition', () => {
    const s = selectNode(null, nodeRuns, 'apply')
    expect(s.def).toBeNull()
    expect(s.index).toBeNull()
    expect(s.nodeRun?.node_type).toBe('bash')
  })
})

describe('failed bash node', () => {
  const apply = nodeRuns[1]

  it('reads the exit code and stderr tail after the prefix', () => {
    expect(exitCode(apply.error)).toBe(1)
    expect(stderrTail(apply.error)).toBe(
      [
        '[apply] loading plan',
        '[apply] guard',
        'Traceback (most recent call last):',
        '  File "apply.py", line 212, in main',
        'GuardError: 3 rows would change artifact_type (expected 0)',
      ].join('\n'),
    )
    expect(stderrTail(apply.error, 2).split('\n')).toHaveLength(2)
    expect(lastErrorLine(apply.error)).toMatch(/^GuardError/)
  })

  it('keeps the whole text when there is no exit prefix or no tail after it', () => {
    expect(exitCode('boom')).toBeNull()
    expect(stderrTail('boom')).toBe('boom')
    const bare = "Bash node 'x' exited with code 1"
    expect(exitCode(bare)).toBe(1)
    expect(stderrTail(bare)).toBe(bare)
  })

  it('computes duration and timeout', () => {
    expect(durationMs(apply, 0)).toBe(41_000)
    expect(timeoutText(apply)).toBe('10m (600000 ms)')
    expect(timeoutText(null)).toBe('not set')
  })
})

describe('usageNote', () => {
  it('is honest per type', () => {
    expect(usageNote('bash', null)).toMatch(/No usage reported for bash nodes/)
    expect(usageNote('approval', null)).toMatch(/do not call a model/)
    expect(usageNote('prompt', { total_tokens: 12 } as NodeRunRow)).toBeNull()
    expect(usageNote('prompt', null)).toMatch(/No usage reported/)
  })
})

describe('approval', () => {
  const paused = {
    ...nodeRuns[0],
    status: 'paused',
  }

  it('reads message, capture flag from config, response and actor', () => {
    const info = approvalInfo(nodeRuns[0], run, parsed.nodes[1])
    expect(info).toEqual({
      message: 'ready?',
      captureResponse: true,
      response: 'apply all',
      actor: 'switchui',
    })
    expect(approvalInfo(nodeRuns[1], run, null)).toBeNull()
  })

  it('awaits only while the run and the node are paused', () => {
    const pausedRun = { ...run, status: 'paused' }
    expect(isAwaitingApproval(paused, pausedRun)).toBe(true)
    expect(isAwaitingApproval(paused, run)).toBe(false)
    expect(isAwaitingApproval(nodeRuns[0], pausedRun)).toBe(false)
  })
})

describe('misc', () => {
  it('formats a wait counter', () => {
    expect(fmtWait(423_000)).toBe('7m 03s')
    expect(fmtWait(null)).toBe('—')
  })

  it('reads artifact labels from a JSON column', () => {
    const nr = {
      artifact_refs: '[{"label":"a.json"},{"path":"runs/x/"}]',
    } as NodeRunRow
    expect(artifactLabels(nr)).toEqual(['a.json', 'runs/x/'])
    expect(artifactLabels({ artifact_refs: '{bad' } as NodeRunRow)).toEqual([])
  })
})

describe('configText', () => {
  it('unpacks a JSON config and keeps plain text', () => {
    expect(
      configText({ id: 'a', config: '{"bash":"set -e\\nls","n":2}' }),
    ).toBe('bash:\nset -e\nls\nn: 2')
    expect(configText({ id: 'a', config: 'python3 apply.py' })).toBe(
      'python3 apply.py',
    )
    expect(configText(null)).toBe('')
  })
  it('flattens one nested object level', () => {
    expect(
      configText({ id: 'a', config: '{"env":{"A":"1","B":{"x":1}}}' }),
    ).toBe('env:\n  A: 1\n  B:\n  {\n    "x": 1\n  }')
  })
})
