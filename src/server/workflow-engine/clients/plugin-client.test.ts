/**
 * Unit tests for PluginClient — mocks fetch, asserts URL + body per method.
 *
 * Runs in Node (forks pool per vite.config.ts poolMatchGlobs).
 * No real HTTP calls; no real plugin process required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock gateway-capabilities before importing PluginClient ──────────────────
vi.mock('../../gateway-capabilities.js', () => ({
  dashboardFetch: vi.fn(),
}));

import { PluginClient } from './plugin-client.js';

const PLUGIN_BASE = '/api/plugins/workflow-engine';

// ---------------------------------------------------------------------------
// Helper: build a fake Response
// ---------------------------------------------------------------------------
function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Setup: we run server-side (no window), so _proxyFetch uses dashboardFetch.
// We intercept it via a module-level fetch mock.
// ---------------------------------------------------------------------------
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchMock = vi.fn();
  const mod = await import('../../gateway-capabilities.js');
  vi.mocked(mod.dashboardFetch).mockImplementation(fetchMock);
});

// Helper to get the last call's URL
function lastUrl(): string {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
}
function lastInit(): RequestInit | undefined {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1] as RequestInit | undefined;
}

const client = new PluginClient();

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

describe('PluginClient.listDefinitions', () => {
  it('calls GET /definitions', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ definitions: [] }));
    const result = await client.listDefinitions();
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/definitions`);
    expect(result).toEqual([]);
  });

  it('passes source filter as query param', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ definitions: [] }));
    await client.listDefinitions({ source: 'bundled' });
    expect(lastUrl()).toContain('source=bundled');
  });
});

describe('PluginClient.getDefinition', () => {
  it('calls GET /definitions/{id}', async () => {
    const def = { id: 'my-wf', name: 'My WF' };
    fetchMock.mockResolvedValue(fakeResponse({ definition: def }));
    const result = await client.getDefinition('my-wf');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/definitions/my-wf`);
    expect(result).toMatchObject({ id: 'my-wf' });
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ error: 'not found' }, 404));
    // _get throws with "404" in the message; getDefinition catches it
    // Actually _get throws — but getDefinition catches 404 → null
    const result = await client.getDefinition('no-such');
    expect(result).toBeNull();
  });
});

describe('PluginClient.deleteWorkflowDefinition', () => {
  it('calls DELETE /definitions/{id} and returns 1', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: true }));
    const n = await client.deleteWorkflowDefinition('my-wf');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/definitions/my-wf`);
    expect(lastInit()?.method).toBe('DELETE');
    expect(n).toBe(1);
  });

  it('returns 0 on 404', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ error: 'not found' }, 404));
    const n = await client.deleteWorkflowDefinition('missing');
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

describe('PluginClient.listRuns', () => {
  it('calls GET /runs', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ runs: [] }));
    await client.listRuns();
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs`);
  });

  it('passes workflowId as query param', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ runs: [] }));
    await client.listRuns({ workflowId: 'hello-world' });
    expect(lastUrl()).toContain('workflow_id=hello-world');
  });
});

describe('PluginClient.getRun', () => {
  it('calls GET /runs/{runId}', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ run: { id: 'r1' } }));
    const run = await client.getRun('r1');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r1`);
    expect(run).toMatchObject({ id: 'r1' });
  });
});

describe('PluginClient.startRun', () => {
  it('calls POST /runs with correct body', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ run: { id: 'r2' } }, 201));
    await client.startRun('hello-world', { key: 'val' }, {
      kind: 'manual',
      conversation_id: 'conv-1',
      user_message: 'go',
    });
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs`);
    const body = JSON.parse(lastInit()?.body as string);
    expect(body.workflow_id).toBe('hello-world');
    expect(body.conversation_id).toBe('conv-1');
    expect(body.variables).toEqual({ key: 'val' });
  });
});

describe('PluginClient.cancelRun', () => {
  it('calls POST /runs/{runId}?action=cancel', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: true }));
    await client.cancelRun('r3');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r3`);
    expect(lastUrl()).toContain('action=cancel');
  });
});

describe('PluginClient.resumeWorkflowRun', () => {
  it('calls POST /runs/{id}/resume', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ run: { id: 'r4' } }));
    await client.resumeWorkflowRun('r4');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r4/resume`);
  });
});

describe('PluginClient.findRunByConversationId', () => {
  it('calls GET /runs/by-conversation/{convId}', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ run: { conversation_id: 'conv-x' } }));
    const run = await client.findRunByConversationId('conv-x');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/by-conversation/conv-x`);
    expect(run).toMatchObject({ conversation_id: 'conv-x' });
  });
});

describe('PluginClient.getActiveWorkflowRunByPath', () => {
  it('calls GET /runs/active?scope_path=...', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ run: null }));
    const run = await client.getActiveWorkflowRunByPath('/my/project');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/active`);
    expect(lastUrl()).toContain('scope_path=');
    expect(run).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Node Runs
// ---------------------------------------------------------------------------

describe('PluginClient.listNodeRuns', () => {
  it('calls GET /runs/{runId}/nodes', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ nodeRuns: [] }));
    await client.listNodeRuns('r5');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r5/nodes`);
  });
});

describe('PluginClient.findNodeRunById', () => {
  it('calls GET /node-runs/{id}', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ nodeRun: { id: 'nr1' } }));
    const nr = await client.findNodeRunById('nr1');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/node-runs/nr1`);
    expect(nr).toMatchObject({ id: 'nr1' });
  });

  it('returns null on 404', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ error: 'not found' }, 404));
    const nr = await client.findNodeRunById('missing');
    expect(nr).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe('PluginClient.appendWorkflowEvent', () => {
  it('calls POST /runs/{runId}/events', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ ok: true }));
    await client.appendWorkflowEvent({
      workflow_run_id: 'r6',
      event_type: 'my_event',
      data: { x: 1 },
    });
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r6/events`);
    const body = JSON.parse(lastInit()?.body as string);
    expect(body.event_type).toBe('my_event');
    expect(body.data).toEqual({ x: 1 });
    // workflow_run_id should NOT be in body (stripped)
    expect(body.workflow_run_id).toBeUndefined();
  });
});

describe('PluginClient.listRecentWorkflowEvents', () => {
  it('calls GET /runs/{runId}/events?limit=N', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ events: [] }));
    await client.listRecentWorkflowEvents('r7', 50);
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r7/events`);
    expect(lastUrl()).toContain('limit=50');
  });
});

// ---------------------------------------------------------------------------
// Phase Transitions
// ---------------------------------------------------------------------------

describe('PluginClient.recordPhaseTransition', () => {
  it('calls POST /runs/{runId}/phase-transitions', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ from: 'plan', to: 'execute' }));
    const result = await client.recordPhaseTransition({
      runId: 'r8',
      toPhase: 'execute',
      decidedBy: 'user',
    });
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r8/phase-transitions`);
    const body = JSON.parse(lastInit()?.body as string);
    expect(body.toPhase).toBe('execute');
    expect(body.decidedBy).toBe('user');
    expect(result).toEqual({ from: 'plan', to: 'execute' });
  });
});

describe('PluginClient.listPhaseTransitions', () => {
  it('calls GET /runs/{runId}/phase-transitions', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ phaseTransitions: [] }));
    const result = await client.listPhaseTransitions('r9');
    expect(lastUrl()).toContain(`${PLUGIN_BASE}/runs/r9/phase-transitions`);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

describe('PluginClient.tryClaimApprovalForResume', () => {
  it('calls POST /runs/.../approval-claim with correct body', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ claimed: true, terminalStatus: 'completed' }));
    const result = await client.tryClaimApprovalForResume('nr-1', 'approved', 'lgtm');
    expect(lastUrl()).toContain('approval-claim');
    const body = JSON.parse(lastInit()?.body as string);
    expect(body.nodeRunId).toBe('nr-1');
    expect(body.decision).toBe('approved');
    expect(body.approvalResponse).toBe('lgtm');
    expect(result.claimed).toBe(true);
    expect(result.terminalStatus).toBe('completed');
  });
});
