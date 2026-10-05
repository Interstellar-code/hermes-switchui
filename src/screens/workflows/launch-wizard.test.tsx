// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LaunchDialog } from './launch-wizard'

const launchWorkflowRun = vi.fn()
const WFS = [
  {
    id: 'wf-a',
    name: 'Alpha',
    description: '',
    node_count: 3,
    required_inputs: ['issue'],
    optional_inputs: [],
    kind: 'workflow',
  },
  {
    id: 'wf-b',
    name: 'Beta',
    description: '',
    node_count: 2,
    required_inputs: [],
    optional_inputs: [],
    kind: 'workflow',
  },
]
const PARSED = {
  definition: { id: 'wf-a' },
  parsed: {
    nodes: [
      { id: 'plan', type: 'prompt' },
      { id: 'gate', type: 'approval' },
      { id: 'ship', type: 'bash' },
    ],
    required_inputs: ['issue'],
    optional_inputs: ['branch', 'force'],
    inputs_detail: [
      { name: 'issue', type: 'string', required: true },
      { name: 'branch', type: 'string', required: false, default: 'main' },
      { name: 'force', type: 'boolean', required: false },
    ],
  },
}
let scheduler: { schedulerAlive: boolean } | undefined
let schedulerError = false
let features: {
  features: Array<string>
  schedulerAlive: boolean
  profile: string | null
} = {
  features: [],
  schedulerAlive: false,
  profile: null,
}
let defs: { data?: typeof WFS; isLoading: boolean; isError?: boolean }

vi.mock('./use-workflows', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useWorkflowDefinitions: () => ({ ...defs, refetch: vi.fn() }),
    useWorkflowParsed: (id: string | null) => ({
      data: id === 'wf-a' ? PARSED : undefined,
      isLoading: false,
    }),
    useWorkflowFeatures: () => ({ data: features, isError: false }),
    useLaunchWorkflowRun: () => useMutation({ mutationFn: launchWorkflowRun }),
  }
})
vi.mock('./run-status', () => ({
  useWorkflowRunIndex: () => ({ data: undefined }),
}))
vi.mock('@/screens/gateway/conductor/use-conductor-queries', () => ({
  useConductorScheduled: () => ({ data: scheduler, isError: schedulerError }),
}))

function mount(props: Partial<React.ComponentProps<typeof LaunchDialog>> = {}) {
  const onClose = vi.fn()
  const onRunLaunched = vi.fn()
  const client = new QueryClient()
  const tree = () => (
    <QueryClientProvider client={client}>
      <LaunchDialog
        open
        onClose={onClose}
        onRunLaunched={onRunLaunched}
        {...props}
      />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { onClose, onRunLaunched, rerender: () => view.rerender(tree()) }
}

const next = () =>
  fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
const input = (name: RegExp) => screen.getByLabelText(name)

beforeEach(() => {
  scheduler = { schedulerAlive: false }
  defs = { data: WFS, isLoading: false }
  schedulerError = false
  features = { features: [], schedulerAlive: false, profile: null }
  launchWorkflowRun.mockReset().mockResolvedValue({ run: { id: 'run-1' } })
})
afterEach(cleanup)

const atTime = (offsetMs: number) => {
  const when = new Date(Date.now() + offsetMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`
}
const atRadio = () => screen.getByRole('radio', { name: /^At a time/ })

describe('LaunchDialog', () => {
  it('honours initialStep, and starts at WORKFLOW without a workflow', async () => {
    mount({ initialWorkflowId: 'wf-a', initialStep: 'confirm' })
    expect(await screen.findByLabelText(/^issue/)).toBeTruthy()
    cleanup()
    mount({ initialWorkflowId: 'wf-b', initialStep: 'confirm' })
    expect(await screen.findByRole('button', { name: /Launch/ })).toBeTruthy()
    cleanup()
    mount({ initialStep: 'confirm' })
    expect(await screen.findByLabelText('Find a workflow')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('titles the dialog (New mission default, overridable)', () => {
    mount()
    expect(screen.getByRole('dialog', { name: 'New mission' })).toBeTruthy()
    cleanup()
    mount({ title: 'Run workflow' })
    expect(screen.getByRole('dialog', { name: 'Run workflow' })).toBeTruthy()
  })

  it('skips the picker when preselected; "change" brings it back', async () => {
    mount({ initialWorkflowId: 'wf-a' })
    expect(await screen.findByLabelText(/^issue/)).toBeTruthy()
    expect(screen.queryByLabelText('Find a workflow')).toBeNull()
    fireEvent.change(input(/^issue/), { target: { value: '42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change workflow' }))
    expect(document.activeElement).toBe(
      screen.getByLabelText('Find a workflow'),
    )
    // Re-picking the same workflow keeps what was typed.
    next()
    expect((input(/^issue/) as HTMLInputElement).value).toBe('42')
  })

  it('preselected workflow + definitions failed → Retry, not a silent dead Next', () => {
    defs = { data: undefined, isLoading: false, isError: true }
    mount({ initialWorkflowId: 'wf-a' })
    expect(screen.getByRole('alert').textContent).toMatch(
      /Couldn't load workflows/,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('never folds a chosen "At a time" into run-now when the scheduler drops', async () => {
    scheduler = { schedulerAlive: true }
    const { rerender } = mount({
      initialWorkflowId: 'wf-b',
      initialStep: 'when',
    })
    fireEvent.click(atRadio())
    fireEvent.change(input(/Date and time/), {
      target: { value: atTime(3_600_000) },
    })
    next()
    // Scheduler query errors (stale alive data kept) → blocked on CONFIRM.
    schedulerError = true
    rerender()
    const primary = screen.getByRole('button', { name: 'Schedule ▶' })
    expect(primary.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('alert').textContent).toMatch(/can’t be scheduled/)
    fireEvent.click(primary)
    expect(launchWorkflowRun).not.toHaveBeenCalled()
    // Back on WHEN: warning visible, Next blocked until Now is picked.
    fireEvent.click(screen.getByRole('button', { name: 'Edit when' }))
    expect(screen.getByRole('alert').textContent).toMatch(/can’t be scheduled/)
    expect(
      screen.getByRole('button', { name: /^Next/ }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /^Now/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    next()
    fireEvent.click(screen.getByRole('button', { name: 'Launch ▶' }))
    await waitFor(() => expect(launchWorkflowRun).toHaveBeenCalled())
    expect(launchWorkflowRun.mock.calls[0][0].schedule).toEqual({ type: 'now' })
  })

  it('picks a workflow from the grid, filters by NO INPUTS', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'No inputs' }))
    expect(screen.queryByRole('button', { name: /^Alpha/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Beta/ }))
    next()
    expect(screen.getByText('This workflow takes no inputs.')).toBeTruthy()
  })

  it('shows "Workflow not found" for an unknown id, then lets you pick', () => {
    const { onClose } = mount({ initialWorkflowId: 'nope' })
    expect(screen.getByText('Workflow not found')).toBeTruthy()
    expect(screen.getByText(/No workflow with the id “nope”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pick a workflow' }))
    expect(screen.queryByText('Workflow not found')).toBeNull()
    expect(screen.getByLabelText('Find a workflow')).toBeTruthy()
  })

  it('shows skeleton rows while loading, and Retry on failure', () => {
    defs = { data: undefined, isLoading: true }
    mount()
    expect(screen.getByLabelText('Loading workflows')).toBeTruthy()
    expect(screen.queryByText(/No workflows/)).toBeNull()
    cleanup()
    defs = { data: undefined, isLoading: false, isError: true }
    mount()
    expect(screen.getByRole('alert').textContent).toMatch(
      /Couldn't load workflows/,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('gates INPUTS on required fields', async () => {
    mount({ initialWorkflowId: 'wf-a' })
    const nextBtn = await screen.findByRole('button', { name: /^Next/ })
    expect(nextBtn.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input(/^issue/), { target: { value: '42' } })
    expect(nextBtn.hasAttribute('disabled')).toBe(false)
  })

  it('scheduler offline disables "At a time" with a visible reason; Repeat always disabled', async () => {
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    expect(
      (await screen.findByRole('radio', { name: /^Now/ })).matches(':checked'),
    ).toBe(true)
    expect(atRadio().hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByRole('radio', { name: /^Repeat/ }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/Scheduler offline/)
    cleanup()
    scheduler = { schedulerAlive: true }
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    expect(atRadio().hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('status').textContent).toMatch(/Scheduler alive/)
  })

  it('CONFIRM lists every input (set or default), when, and the step graph', async () => {
    mount({ initialWorkflowId: 'wf-a' })
    fireEvent.change(await screen.findByLabelText(/^issue/), {
      target: { value: '42' },
    })
    next()
    next()
    const inputs = screen.getByRole('region', { name: 'Inputs' })
    expect(inputs.textContent).toContain('issue42')
    expect(inputs.textContent).toContain('branchdefault · main')
    expect(inputs.textContent).toContain('forcenot set')
    expect(inputs.textContent).toContain('contextnone')
    expect(screen.getByRole('region', { name: 'When' }).textContent).toMatch(
      /Now/,
    )
    const plan = screen.getByRole('region', { name: 'What will happen' })
    expect(plan.textContent).toContain('gate ⏸')
    expect(plan.textContent).toMatch(/Runs 3 steps\. Pauses at “gate”/)
    fireEvent.click(screen.getByRole('button', { name: 'Edit inputs' }))
    expect(screen.getByLabelText(/^issue/)).toBeTruthy()
  })

  it('launches with variables (declared defaults only), fires onRunLaunched', async () => {
    const { onRunLaunched, onClose } = mount({ initialWorkflowId: 'wf-a' })
    fireEvent.change(await screen.findByLabelText(/^issue/), {
      target: { value: ' 42 ' },
    })
    fireEvent.change(screen.getByLabelText(/Context for this run/), {
      target: { value: 'hi' },
    })
    next()
    next()
    expect(screen.queryByRole('button', { name: /Schedule/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Launch ▶' }))
    await waitFor(() =>
      expect(onRunLaunched).toHaveBeenCalledWith('run-1', 'wf-a'),
    )
    expect(onClose).toHaveBeenCalled()
    const payload = launchWorkflowRun.mock.calls[0][0]
    // only user-edited values are sent; the engine applies YAML defaults (branch).
    expect(payload.variables).toEqual({ issue: '42' })
    expect(payload.priority).toBe(50)
    expect(payload.maxRuntimeSeconds).toBe(3600)
    expect(payload.user_message).toBe('hi')
    expect(payload.schedule).toEqual({ type: 'now' })
    expect(payload.workflow_id).toBe('wf-a')
    expect(typeof payload.conversation_id).toBe('string')
    expect(payload.conversation_id.length).toBeGreaterThan(0)
  })

  it('schedules AT when the scheduler is alive (SCHEDULE label) and does not select a run', async () => {
    scheduler = { schedulerAlive: true }
    const { onRunLaunched } = mount({
      initialWorkflowId: 'wf-b',
      initialStep: 'when',
    })
    fireEvent.click(atRadio())
    const local = atTime(3_600_000)
    fireEvent.change(input(/Date and time/), { target: { value: local } })
    next()
    expect(screen.queryByRole('button', { name: /Launch/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Schedule ▶' }))
    await waitFor(() => expect(launchWorkflowRun).toHaveBeenCalled())
    expect(launchWorkflowRun.mock.calls[0][0].schedule).toEqual({
      type: 'at',
      at: new Date(local).toISOString(),
    })
    expect(onRunLaunched).not.toHaveBeenCalled()
  })

  it('refuses to schedule a time that has passed by submit', async () => {
    scheduler = { schedulerAlive: true }
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    fireEvent.click(atRadio())
    fireEvent.change(input(/Date and time/), {
      target: { value: atTime(120_000) },
    })
    next()
    const realNow = Date.now
    Date.now = () => realNow() + 3_600_000
    try {
      fireEvent.click(screen.getByRole('button', { name: /Schedule/ }))
    } finally {
      Date.now = realNow
    }
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Scheduled time has passed/,
    )
    expect(launchWorkflowRun).not.toHaveBeenCalled()
  })

  it('clamps initialStep to INPUTS when a required input is empty', async () => {
    mount({ initialWorkflowId: 'wf-a', initialStep: 'confirm' })
    expect(await screen.findByLabelText(/^issue/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Launch/ })).toBeNull()
  })

  it('renders nothing when closed', () => {
    mount({ open: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('Repeat', () => {
    const repeatRadio = () => screen.getByRole('radio', { name: /^Repeat/ })
    const toWhen = () => {
      mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    }
    it.each([
      [
        'engine too old',
        { features: [], schedulerAlive: true, profile: 'hermes-switch' },
        /Engine too old/,
      ],
      [
        'scheduler offline',
        {
          features: ['cron_schedule'],
          schedulerAlive: false,
          profile: 'hermes-switch',
        },
        /Scheduler offline/,
      ],
      [
        'wrong profile',
        {
          features: ['cron_schedule'],
          schedulerAlive: true,
          profile: 'default',
        },
        /hermes-switch profile/,
      ],
    ])('is disabled with a reason: %s', (_n, f, reason) => {
      features = f
      toWhen()
      expect((repeatRadio() as HTMLInputElement).disabled).toBe(true)
      expect(screen.getAllByText(reason).length).toBeGreaterThan(0)
    })

    it('schedules a cron launch', async () => {
      features = {
        features: ['cron_schedule'],
        schedulerAlive: true,
        profile: 'hermes-switch',
      }
      toWhen()
      fireEvent.click(repeatRadio())
      fireEvent.change(input(/Cron expression/), { target: { value: 'nope' } })
      expect(screen.getByRole('button', { name: /^Next/ }).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Weekdays 09:00' }))
      expect(screen.getByText(/^next: /)).toBeTruthy()
      next()
      fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
      await waitFor(() => expect(launchWorkflowRun).toHaveBeenCalled())
      expect(launchWorkflowRun.mock.calls[0][0].schedule).toEqual({
        type: 'cron',
        cron: '0 9 * * 1-5',
      })
    })
  })
})
