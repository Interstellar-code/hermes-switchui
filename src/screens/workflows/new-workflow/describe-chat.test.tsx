// @vitest-environment jsdom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import { installReactFlowShims } from '../graph-editor/react-flow-test-shims'
import { DescribeChatPane } from './describe-chat'
import { useDescribeChat } from './use-describe-chat'
import { SourceStep } from './source-step'
import type { SourceKind } from './source-step'

beforeAll(() => {
  installReactFlowShims()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function createEventStream(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function sseResponse(payload: Record<string, unknown>, status = 200): Response {
  const stream = createEventStream([
    'event: chunk\n',
    `data: ${JSON.stringify({ text: JSON.stringify(payload) })}\n\n`,
  ])
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function DescribeTestHarness(props: {
  initialYaml?: string
  initialName?: string
  onSwitchToTemplate?: () => void
  onAppliedYaml?: (yaml: string) => void
}) {
  const [yaml, setYaml] = useState(
    props.initialYaml ??
      `name: Demo Workflow
nodes:
  - id: start
    prompt: initial prompt
`,
  )
  const [name, setName] = useState(props.initialName ?? 'Demo Workflow')
  const [description, setDescription] = useState('A demo workflow')
  const [id, setId] = useState('demo-wf')

  const describeChat = useDescribeChat({
    yaml,
    name,
    description,
    id,
    applyParsedDocument: (doc) => {
      setName(doc.name)
      setDescription(doc.description)
      props.onAppliedYaml?.(doc.name)
    },
    setYaml: (nextYaml) => {
      setYaml(nextYaml)
      props.onAppliedYaml?.(nextYaml)
    },
    onSwitchToTemplate: props.onSwitchToTemplate,
  })

  return (
    <DescribeChatPane
      {...describeChat}
      onSwitchToTemplate={
        props.onSwitchToTemplate ?? describeChat.onSwitchToTemplate
      }
    />
  )
}

function SourceStepHarness(props: {
  onKindChange?: (kind: SourceKind) => void
  fetchSessionsError?: boolean
}) {
  const [kind, setKind] = useState<SourceKind>('describe')
  const [yaml, setYaml] = useState(
    `name: Demo Workflow
nodes:
  - id: start
    prompt: initial prompt
`,
  )
  const [name] = useState('Demo Workflow')
  const [description] = useState('')
  const [id, setId] = useState('demo-wf')

  const describeChat = useDescribeChat({
    yaml,
    name,
    description,
    id,
    applyParsedDocument: () => {},
    setYaml,
  })

  return (
    <SourceStep
      kind={kind}
      onKind={(nextKind) => {
        setKind(nextKind)
        props.onKindChange?.(nextKind)
      }}
      describePane={<DescribeChatPane {...describeChat} />}
      workflows={[]}
      workflowsLoading={false}
      workflowsError={null}
      onRetryWorkflows={() => {}}
      selectedWorkflowId=""
      onSelectWorkflow={() => {}}
      id={id}
      onIdChange={setId}
      idStatus="available"
      takenIds={new Set()}
      importText=""
      importFileName={null}
      onImportText={() => {}}
      importIssues={[]}
      importTooLarge={false}
    />
  )
}

describe('DescribeChat and useDescribeChat (network edge mocked only)', () => {
  it('creates exactly one session on the first send and reuses it on subsequent sends without ever referencing "main"', async () => {
    const draftSessionId = 'wf-draft-sess-99'
    const requestedBodies: Array<Record<string, unknown>> = []

    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr === '/api/sessions') {
          const parsedBody = init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : {}
          requestedBodies.push({ endpoint: '/api/sessions', ...parsedBody })
          return jsonResponse({
            sessionId: draftSessionId,
            sessionKey: draftSessionId,
            friendlyId: draftSessionId,
            label: parsedBody.label,
          })
        }

        if (urlStr.includes('/api/send-stream')) {
          const parsedBody = init?.body
            ? (JSON.parse(String(init.body)) as Record<string, unknown>)
            : {}
          requestedBodies.push({ endpoint: '/api/send-stream', ...parsedBody })
          return sseResponse({
            reply: 'Here is the draft update',
            stage: 'drafting_nodes',
            workflow_yaml: `name: Demo Workflow
nodes:
  - id: step_one
    prompt: first prompt
`,
          })
        }

        return jsonResponse({})
      })

    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness />)

    // Initial greeting is shown
    expect(
      screen.getByText(
        /Let's build a new workflow\. Describe what you want it to do/,
      ),
    ).toBeDefined()

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    // Turn 1
    fireEvent.change(input, { target: { value: 'Create a build pipeline' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(screen.getByText('Here is the draft update')).toBeDefined()
    })

    // Assert /api/sessions was called once with proper label
    const sessionCalls = requestedBodies.filter(
      (b) => b.endpoint === '/api/sessions',
    )
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].label).toMatch(
      /^Workflow draft · Demo Workflow · \d{2}:\d{2}$/,
    )

    // Assert /api/send-stream was called with the draft sessionKey
    const sendCalls = requestedBodies.filter(
      (b) => b.endpoint === '/api/send-stream',
    )
    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0].sessionKey).toBe(draftSessionId)

    // Verify "main" was never sent in any request body
    for (const call of requestedBodies) {
      const serialized = JSON.stringify(call)
      expect(serialized).not.toContain('"main"')
    }

    // Turn 2
    fireEvent.change(input, { target: { value: 'Add a notification step' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      const sendCallsAfter = requestedBodies.filter(
        (b) => b.endpoint === '/api/send-stream',
      )
      expect(sendCallsAfter).toHaveLength(2)
    })

    // Assert /api/sessions was NOT called a second time
    const sessionCallsAfter = requestedBodies.filter(
      (b) => b.endpoint === '/api/sessions',
    )
    expect(sessionCallsAfter).toHaveLength(1)

    // Assert second send reused the same sessionKey
    const sendCallsAfter = requestedBodies.filter(
      (b) => b.endpoint === '/api/send-stream',
    )
    expect(sendCallsAfter[1].sessionKey).toBe(draftSessionId)

    // Verify still no request contains "main"
    for (const call of requestedBodies) {
      const serialized = JSON.stringify(call)
      expect(serialized).not.toContain('"main"')
    }
  })

  it('renders ADDED and CHANGED badges when revision diffs arrive', async () => {
    let callCount = 0
    const draftSessionId = 'wf-draft-diff-session'

    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr === '/api/sessions') {
          return jsonResponse({
            sessionId: draftSessionId,
            sessionKey: draftSessionId,
          })
        }

        if (urlStr.includes('/api/send-stream')) {
          callCount++
          if (callCount === 1) {
            // Revision 1: checkout and test nodes
            return sseResponse({
              reply: 'Created Revision 1',
              workflow_yaml: `name: Diff Workflow
nodes:
  - id: checkout
    bash: git checkout
  - id: test
    bash: pnpm test
`,
            })
          }

          // Revision 2: checkout (changed bash), test (unchanged), deploy (added)
          return sseResponse({
            reply: 'Created Revision 2 with deploy step',
            workflow_yaml: `name: Diff Workflow
nodes:
  - id: checkout
    bash: git checkout --force
  - id: test
    bash: pnpm test
  - id: deploy
    bash: ./deploy.sh
`,
          })
        }

        return jsonResponse({})
      })

    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    // Revision 1
    fireEvent.change(input, { target: { value: 'Make checkout and test' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(screen.getByText('Created Revision 1')).toBeDefined()
      expect(screen.getByRole('button', { name: 'REV 1' })).toBeDefined()
    })

    // Revision 2
    fireEvent.change(input, {
      target: { value: 'Add deploy and modify checkout' },
    })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('Created Revision 2 with deploy step'),
      ).toBeDefined()
      expect(screen.getByRole('button', { name: 'REV 2' })).toBeDefined()
    })

    // Verify badges for Revision 2
    expect(screen.getByText('ADDED: deploy')).toBeDefined()
    expect(screen.getByText('CHANGED: checkout')).toBeDefined()
    // 'test' is unchanged, so neither ADDED: test nor CHANGED: test should be in the badge bar
    expect(screen.queryByText('ADDED: test')).toBeNull()
    expect(screen.queryByText('CHANGED: test')).toBeNull()

    // Test revision switching button
    const rev1Button = screen.getByRole('button', { name: 'REV 1' })
    fireEvent.click(rev1Button)
    expect(screen.getByText('Revision 1')).toBeDefined()

    // "Use this draft" button is present and clickable
    const useDraftBtn = screen.getByRole('button', { name: 'Use this draft' })
    expect(useDraftBtn).toBeDefined()
    fireEvent.click(useDraftBtn)
  })

  it('shows the offline banner with switch-to-template button when draft session creation fails', async () => {
    const onSwitchToTemplate = vi.fn()

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return new Response('Gateway error: failed to initialize session', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return jsonResponse({})
    })

    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness onSwitchToTemplate={onSwitchToTemplate} />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    fireEvent.change(input, { target: { value: 'Initialize my workflow' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('AI drafting unavailable — start from a template'),
      ).toBeDefined()
    })

    const templateBtn = screen.getByRole('button', {
      name: 'Start from a template',
    })
    expect(templateBtn).toBeDefined()

    fireEvent.click(templateBtn)
    expect(onSwitchToTemplate).toHaveBeenCalledTimes(1)
  })

  it('shows the offline banner when send-stream fails', async () => {
    const onSwitchToTemplate = vi.fn()

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return jsonResponse({
          sessionId: 'session-ok',
          sessionKey: 'session-ok',
        })
      }
      if (urlStr.includes('/api/send-stream')) {
        return new Response('Stream error 500', { status: 500 })
      }
      return jsonResponse({})
    })

    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness onSwitchToTemplate={onSwitchToTemplate} />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    fireEvent.change(input, { target: { value: 'Failing stream turn' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('AI drafting unavailable — start from a template'),
      ).toBeDefined()
    })

    const templateBtn = screen.getByRole('button', {
      name: 'Start from a template',
    })
    fireEvent.click(templateBtn)
    expect(onSwitchToTemplate).toHaveBeenCalledTimes(1)
  })

  it('invokes onKind("template") via SourceStep when "Start from a template" is clicked', async () => {
    const onKindChange = vi.fn()

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return new Response('Network offline', { status: 502 })
      }
      return jsonResponse({})
    })

    vi.stubGlobal('fetch', fetchSpy)

    render(<SourceStepHarness onKindChange={onKindChange} />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    fireEvent.change(input, { target: { value: 'Build something' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('AI drafting unavailable — start from a template'),
      ).toBeDefined()
    })

    const templateBtn = screen.getByRole('button', {
      name: 'Start from a template',
    })
    fireEvent.click(templateBtn)

    expect(onKindChange).toHaveBeenCalledWith('template')
  })

  it('shows offline banner and does not call chat when create response lacks a session id', async () => {
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return jsonResponse({ ok: true })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    fireEvent.change(input, { target: { value: 'Create workflow' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('AI drafting unavailable — start from a template'),
      ).toBeDefined()
    })

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]))
    expect(calls).toContain('/api/sessions')
    expect(calls.some((c) => c.includes('/api/send-stream'))).toBe(false)
  })

  it('does not create a revision or update wizard YAML on clarify turn or identical YAML', async () => {
    const onAppliedYaml = vi.fn()
    const draftSessionId = 'wf-clarify-session'
    const initialYaml = `name: Demo Workflow
nodes:
  - id: start
    prompt: initial prompt
`

    let turn = 0
    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return jsonResponse({
          sessionId: draftSessionId,
          sessionKey: draftSessionId,
        })
      }
      if (urlStr.includes('/api/send-stream')) {
        turn++
        if (turn === 1) {
          // Unstructured clarify turn (no workflow_yaml)
          return sseResponse({
            reply: 'Could you clarify the trigger?',
          })
        }
        // Identical YAML turn
        return sseResponse({
          reply: 'Here is the draft without changes',
          workflow_yaml: initialYaml,
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchSpy)

    render(
      <DescribeTestHarness
        initialYaml={initialYaml}
        onAppliedYaml={onAppliedYaml}
      />,
    )

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    // Turn 1: Clarify
    fireEvent.change(input, { target: { value: 'What should I do?' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(screen.getByText('Could you clarify the trigger?')).toBeDefined()
    })

    expect(screen.getByText('Waiting for prompt')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'REV 1' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Node changes' })).toBeNull()
    expect(onAppliedYaml).not.toHaveBeenCalled()

    // Turn 2: Identical YAML
    fireEvent.change(input, { target: { value: 'Keep it as is' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(
        screen.getByText('Here is the draft without changes'),
      ).toBeDefined()
    })

    expect(screen.queryByRole('button', { name: 'REV 1' })).toBeNull()
    expect(onAppliedYaml).not.toHaveBeenCalled()
  })

  it('does not update wizard YAML until "Use this draft" is clicked', async () => {
    const onAppliedYaml = vi.fn()
    const draftSessionId = 'wf-use-draft-session'

    const fetchSpy = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url)
      if (urlStr === '/api/sessions') {
        return jsonResponse({
          sessionId: draftSessionId,
          sessionKey: draftSessionId,
        })
      }
      if (urlStr.includes('/api/send-stream')) {
        return sseResponse({
          reply: 'Generated initial draft',
          workflow_yaml: `name: Updated Draft
nodes:
  - id: step_one
    prompt: run step one
`,
        })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness onAppliedYaml={onAppliedYaml} />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    fireEvent.change(input, { target: { value: 'Generate a plan' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(screen.getByText('Generated initial draft')).toBeDefined()
      expect(screen.getByRole('button', { name: 'REV 1' })).toBeDefined()
    })

    // Wizard YAML must NOT be updated yet
    expect(onAppliedYaml).not.toHaveBeenCalled()

    // Click "Use this draft"
    const useDraftBtn = screen.getByRole('button', { name: 'Use this draft' })
    fireEvent.click(useDraftBtn)

    // Now wizard has been updated
    expect(onAppliedYaml).toHaveBeenCalledTimes(1)
  })

  it('header sessionId does not overwrite the initial draft session id', async () => {
    const initialDraftId = 'wf-initial-draft-id'
    const sendBodies: Array<Record<string, unknown>> = []

    const fetchSpy = vi
      .fn()
      .mockImplementation((url: string | URL, init?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr === '/api/sessions') {
          return jsonResponse({
            sessionId: initialDraftId,
            sessionKey: initialDraftId,
          })
        }
        if (urlStr.includes('/api/send-stream')) {
          if (init?.body) {
            sendBodies.push(
              JSON.parse(String(init.body)) as Record<string, unknown>,
            )
          }
          const stream = createEventStream([
            'event: chunk\n',
            `data: ${JSON.stringify({ text: JSON.stringify({ reply: 'Turn ok', workflow_yaml: 'name: W\nnodes: []\n' }) })}\n\n`,
          ])
          return new Response(stream, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'X-Hermes-Session-Key': 'server-different-session-key',
            },
          })
        }
        return jsonResponse({})
      })
    vi.stubGlobal('fetch', fetchSpy)

    render(<DescribeTestHarness />)

    const input = screen.getByPlaceholderText(
      /Describe your workflow in plain language…/,
    )
    const sendBtn = screen.getByRole('button', { name: 'Send' })

    // Turn 1
    fireEvent.change(input, { target: { value: 'First prompt' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(sendBodies.length).toBe(1)
    })
    expect(sendBodies[0].sessionKey).toBe(initialDraftId)

    // Turn 2
    fireEvent.change(input, { target: { value: 'Second prompt' } })
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(sendBodies.length).toBe(2)
    })
    expect(sendBodies[1].sessionKey).toBe(initialDraftId)
  })
})
