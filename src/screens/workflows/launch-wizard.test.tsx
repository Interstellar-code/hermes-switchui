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

vi.mock('./use-workflows', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  return {
    useWorkflowDefinitions: () => ({ data: WFS, isLoading: false }),
    useWorkflowParsed: (id: string | null) => ({
      data: id === 'wf-a' ? PARSED : undefined,
      isLoading: false,
    }),
    useLaunchWorkflowRun: () => useMutation({ mutationFn: launchWorkflowRun }),
  }
})
vi.mock('./run-status', () => ({
  useWorkflowRunIndex: () => ({ data: undefined }),
}))
vi.mock('@/screens/gateway/conductor/use-conductor-queries', () => ({
  useConductorScheduled: () => ({ data: scheduler }),
}))

function mount(props: Partial<React.ComponentProps<typeof LaunchDialog>> = {}) {
  const onClose = vi.fn()
  const onRunLaunched = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LaunchDialog
        open
        onClose={onClose}
        onRunLaunched={onRunLaunched}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onClose, onRunLaunched }
}

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }))
const input = (name: RegExp) => screen.getByLabelText(name)

beforeEach(() => {
  scheduler = { schedulerAlive: false }
  launchWorkflowRun.mockReset().mockResolvedValue({ run: { id: 'run-1' } })
})
afterEach(cleanup)

describe('LaunchDialog', () => {
  it('honours initialStep, and starts at WORKFLOW without a workflow', async () => {
    mount({ initialWorkflowId: 'wf-a', initialStep: 'confirm' })
    expect(await screen.findByLabelText(/^issue/)).toBeTruthy()
    cleanup()
    mount({ initialWorkflowId: 'wf-b', initialStep: 'confirm' })
    expect(await screen.findByRole('button', { name: /Launch/ })).toBeTruthy()
    cleanup()
    mount({ initialStep: 'confirm' })
    expect(
      await screen.findByText(
        'Pick a workflow on the left to start a mission.',
      ),
    ).toBeTruthy()
  })

  it('gates INPUTS on required fields', async () => {
    mount({ initialWorkflowId: 'wf-a' })
    const nextBtn = await screen.findByRole('button', {
      name: 'Next',
    })
    expect(nextBtn.hasAttribute('disabled')).toBe(true)
    fireEvent.change(input(/^issue/), { target: { value: '42' } })
    expect(nextBtn.hasAttribute('disabled')).toBe(false)
  })

  it('WHEN offers NOW only when the scheduler is down; AT when alive; cron always disabled', async () => {
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    expect(
      (
        await screen.findByRole('button', {
          name: 'At a time',
        })
      ).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen
        .getByRole('button', {
          name: 'Repeat (cron)',
        })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.getByText(/Repeat schedules aren't supported/)).toBeTruthy()
    cleanup()
    scheduler = { schedulerAlive: true }
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    expect(
      (
        await screen.findByRole('button', {
          name: 'At a time',
        })
      ).hasAttribute('disabled'),
    ).toBe(false)
    expect(
      screen
        .getByRole('button', {
          name: 'Repeat (cron)',
        })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('launches with variables (declared defaults only), fires onRunLaunched', async () => {
    const { onRunLaunched, onClose } = mount({ initialWorkflowId: 'wf-a' })
    fireEvent.change(await screen.findByLabelText(/^issue/), {
      target: { value: ' 42 ' },
    })
    fireEvent.change(screen.getByLabelText('Context (optional)'), {
      target: { value: 'hi' },
    })
    next()
    next()
    fireEvent.click(screen.getByRole('button', { name: /Launch/ }))
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
  })

  it('schedules AT when the scheduler is alive and does not select a run', async () => {
    scheduler = { schedulerAlive: true }
    const { onRunLaunched } = mount({
      initialWorkflowId: 'wf-b',
      initialStep: 'when',
    })
    fireEvent.click(await screen.findByRole('button', { name: 'At a time' }))
    const when = new Date(Date.now() + 3_600_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`
    fireEvent.change(input(/Run at/), { target: { value: local } })
    next()
    fireEvent.click(screen.getByRole('button', { name: /Schedule/ }))
    await waitFor(() => expect(launchWorkflowRun).toHaveBeenCalled())
    expect(launchWorkflowRun.mock.calls[0][0].schedule.type).toBe('at')
    expect(onRunLaunched).not.toHaveBeenCalled()
  })

  it('refuses to schedule a time that has passed by submit', async () => {
    scheduler = { schedulerAlive: true }
    mount({ initialWorkflowId: 'wf-b', initialStep: 'when' })
    fireEvent.click(await screen.findByRole('button', { name: 'At a time' }))
    const when = new Date(Date.now() + 120_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`
    fireEvent.change(input(/Run at/), { target: { value: local } })
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
})
