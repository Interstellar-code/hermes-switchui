// @vitest-environment jsdom
// CONFIGURE step: real ConfigureStep / NodeConfigPanel / yaml-model, and the
// real wizard root for the Next gating. Only `fetch` is mocked; the validate
// stub derives its issues from the posted yaml, like the engine does.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { parse } from 'yaml'
import { NewWorkflowWizard } from '../new-workflow-wizard'
import { installReactFlowShims } from '../graph-editor/react-flow-test-shims'
import { readGraph } from '../graph-editor/yaml-model'
import { ConfigureStep } from './configure-step'
import type { WizardIssueState } from './use-wizard-validation'
import type { WorkflowValidationIssue } from '../api-client'

beforeAll(installReactFlowShims)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Engine-like checks for the two fixable codes (message formats as in the engine). */
function fakeValidate(yaml: string): {
  errors: Array<WorkflowValidationIssue>
} {
  const doc = parse(yaml) as {
    inputs?: Array<{ name: string }>
    nodes: Array<Record<string, unknown> & { id: string }>
  }
  const lines = yaml.split('\n')
  const lineOf = (text: string) => {
    const i = lines.findIndex((l) => l.includes(text))
    return i < 0 ? null : i + 1
  }
  const ids = doc.nodes.map((n) => n.id)
  const declared = (doc.inputs ?? []).map((i) => i.name)
  const errors: Array<WorkflowValidationIssue> = []
  for (const n of doc.nodes) {
    for (const dep of (n.depends_on as Array<string> | undefined) ?? []) {
      if (!ids.includes(dep))
        errors.push({
          line: lineOf(dep),
          col: null,
          code: 'unknown_dependency',
          message: `node '${n.id}' depends on unknown node '${dep}'`,
          node_id: n.id,
        })
    }
    for (const m of JSON.stringify(n).matchAll(/\$INPUTS\.(\w+)/g)) {
      if (!declared.includes(m[1]))
        errors.push({
          line: lineOf(m[0]),
          col: null,
          code: 'undeclared_input',
          message: `node '${n.id}' references undeclared input '${m[1]}'`,
          node_id: n.id,
        })
    }
  }
  return { errors }
}

function stubFetch(opts: { validateDelay?: () => Promise<void> } = {}) {
  const validated: Array<string> = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.includes('/api/workflow-features'))
      return json({
        features: ['validate'],
        schedulerAlive: false,
        profile: null,
      })
    if (url.includes('/api/workflow-definitions/validate')) {
      const body = JSON.parse(String(init?.body)) as {
        yaml: string
        id?: string
      }
      if (body.id)
        return json({ ok: true, errors: [], warnings: [], id_available: true })
      await opts.validateDelay?.()
      validated.push(body.yaml)
      const { errors } = fakeValidate(body.yaml)
      return json({
        ok: errors.length === 0,
        errors,
        warnings: [],
        id_available: null,
      })
    }
    return json({ definitions: [], engine_ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { validated }
}

const BASE = `name: Digest # keep this comment
description: weekly digest
x-top: kept
nodes:
  - id: fetch
    bash: echo fetch
    x-node: kept
  - id: rank
    prompt: Rank $fetch.output
    depends_on: [fetch]
`

function renderStandalone(issues: WizardIssueState = { kind: 'pending' }) {
  const changes: Array<string> = []
  function Host() {
    const [yaml, setYaml] = useState(BASE)
    return (
      <ConfigureStep
        yaml={yaml}
        onChange={(y) => {
          changes.push(y)
          setYaml(y)
        }}
        issues={issues}
        workflowId="digest"
      />
    )
  }
  const utils = render(<Host />)
  return { ...utils, changes }
}

const mirror = () =>
  Array.from(
    screen.getByTestId('yaml-mirror').querySelectorAll('.wz2-yl'),
    (row) => row.lastElementChild?.textContent ?? '',
  ).join('\n') + '\n'

describe('ConfigureStep', () => {
  it('a form field edit changes exactly that key in the mirror (unknown keys survive)', () => {
    renderStandalone()
    expect(mirror()).toBe(BASE)
    fireEvent.click(screen.getByRole('button', { name: /rank/ }))
    fireEvent.change(screen.getByLabelText('STAGE'), {
      target: { value: 'report' },
    })
    expect(mirror()).toBe(`${BASE}    phase: report\n`)
  })

  it('highlights the selected node lines and the lines of each issue', () => {
    renderStandalone({
      kind: 'ready',
      errors: [
        {
          line: 9,
          col: null,
          code: 'x',
          message: 'bad prompt',
          node_id: 'rank',
        },
      ],
      warnings: [],
    })
    fireEvent.click(screen.getByRole('button', { name: /fetch/ }))
    const cls = (line: number) =>
      screen.getByTestId('yaml-mirror').querySelector(`[data-line="${line}"]`)!
        .className
    expect([5, 6, 7].map(cls).every((c) => c.includes('hi'))).toBe(true)
    expect(cls(8)).not.toContain('hi')
    expect(cls(9)).toContain('bad')
    expect(screen.getByText(/L9 · bad prompt/)).toBeTruthy()
  })
})

/** Wizard on CONFIGURE with a clean BASE draft (validate feature on). */
async function wizardOnConfigure() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <NewWorkflowWizard
        initialYaml={BASE}
        initialId="digest"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
  const next = () => screen.getByRole('button', { name: /next/i })
  await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))
  fireEvent.click(next()) // → DESIGN
  await waitFor(() => expect(screen.getByText(/2 DESIGN/)).toBeTruthy())
  await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))
  fireEvent.click(next()) // → CONFIGURE
  await waitFor(() => expect(screen.getByText(/3 CONFIGURE/)).toBeTruthy())
  return { next }
}

describe('CONFIGURE in the wizard: one-click fixes and Next gating', () => {
  it('Declare input: Next blocked while pending and on the error, enabled after a clean re-validate', async () => {
    let release: (() => void) | null = null
    let hold = false
    const { validated } = stubFetch({
      validateDelay: () =>
        hold ? new Promise<void>((r) => (release = r)) : Promise.resolve(),
    })
    const { next } = await wizardOnConfigure()
    await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))

    // introduce an undeclared input; hold the validate answer → pending
    hold = true
    fireEvent.click(screen.getByRole('button', { name: /rank/ }))
    fireEvent.change(screen.getByLabelText('PROMPT'), {
      target: { value: 'Rank for $INPUTS.chat_id' },
    })
    expect(next().hasAttribute('disabled')).toBe(true)
    expect(screen.getAllByText(/Validating/).length).toBeGreaterThan(0)
    // the validate call for the edited yaml is in flight and held
    await waitFor(() => expect(release).not.toBeNull())
    expect(next().hasAttribute('disabled')).toBe(true)
    hold = false
    act(() => release!())

    const fix = await screen.findByRole('button', {
      name: 'Declare input chat_id',
    })
    expect(next().hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Fix 1 error to continue/)).toBeTruthy()

    fireEvent.click(fix)
    const fixed = parse(mirror()) as { inputs: Array<{ name: string }> }
    expect(fixed.inputs).toEqual([{ name: 'chat_id' }])
    expect(readGraph(mirror())!.nodes).toHaveLength(2)
    expect(mirror()).toContain('x-node: kept')
    // re-validated with the fixed yaml → the issue is gone, Next enabled
    await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))
    expect(validated[validated.length - 1]).toBe(mirror())
    expect(fakeValidate(mirror()).errors).toEqual([])
    expect(screen.queryByText(/undeclared input/)).toBeNull()
  })

  it('Remove dep (reached via Review → Back) drops only that depends_on entry and re-validates clean', async () => {
    const { validated } = stubFetch()
    const { next } = await wizardOnConfigure()
    await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))
    fireEvent.click(next()) // → REVIEW: hand-edit a dangling dep into the yaml
    const editor = await screen.findByRole('textbox', { name: /yaml/i })
    fireEvent.change(editor, {
      target: { value: BASE.replace('[fetch]', '[fetch, ghost]') },
    })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByText(/3 CONFIGURE/)).toBeTruthy())

    const fix = await screen.findByRole('button', { name: 'Remove dep ghost' })
    expect(next().hasAttribute('disabled')).toBe(true)
    fireEvent.click(fix)
    const graph = readGraph(mirror())!
    expect(graph.nodes.find((n) => n.id === 'rank')!.dependsOn).toEqual([
      'fetch',
    ])
    expect(mirror()).toBe(BASE)
    await waitFor(() => expect(next().hasAttribute('disabled')).toBe(false))
    // the fixed yaml equals BASE, already validated → served from the cache
    expect(validated).toContain(mirror())
    expect(screen.queryByText(/unknown node/)).toBeNull()
  })
})
