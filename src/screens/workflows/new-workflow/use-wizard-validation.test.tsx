// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRef } from 'react'
import { getWorkflowFeatures } from '../api-client'
import { useWizardValidation } from './use-wizard-validation'

vi.mock('../api-client', async (importOriginal) => {
  const actual = await importOriginal<object>()
  return {
    ...actual,
    validateWorkflowDefinition: vi.fn().mockResolvedValue({
      ok: true,
      errors: [],
      warnings: [],
      id_available: true,
    }),
    getWorkflowFeatures: vi.fn(),
  }
})

const mockGetFeatures = vi.mocked(getWorkflowFeatures)

function Probe({ yaml, id }: { yaml: string; id: string }) {
  const validation = useWizardValidation({ yaml, id, existingIds: null })
  const renders = useRef(0)
  renders.current += 1
  return (
    <span
      data-testid="probe"
      data-renders={renders.current}
      data-id={validation.idStatus}
    />
  )
}

describe('useWizardValidation debounce', () => {
  beforeEach(() => {
    mockGetFeatures.mockResolvedValue({
      features: [],
      schedulerAlive: false,
      profile: null,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('settles without further renders while props are unchanged', async () => {
    vi.useFakeTimers()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { getByTestId } = render(
      <QueryClientProvider client={client}>
        <Probe yaml={'name: x\nnodes:\n  - id: a\n    prompt: hi\n'} id="wf" />
      </QueryClientProvider>,
    )

    const count = () => Number(getByTestId('probe').dataset['renders'])

    // Let the initial debounce settle and the features query resolve.
    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    const settled = count()
    expect(settled).toBeGreaterThan(0)

    // With the object-debounce bug, every 200ms timeout did setState with a
    // fresh object, so renders kept growing forever. With debounced strings
    // nothing may render while the inputs are unchanged.
    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(count()).toBe(settled)
  })
})

function IdProbe(p: {
  id: string
  existingIds: ReadonlySet<string> | null
  conflictIds?: ReadonlySet<string>
}) {
  const v = useWizardValidation({ yaml: 'name: x\n', ...p })
  return <span data-testid="id" data-id={v.idStatus} />
}

function renderIdProbe(p: Parameters<typeof IdProbe>[0]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <IdProbe {...p} />
    </QueryClientProvider>,
  )
}

describe('useWizardValidation id status', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('a 409 conflict alone never makes other ids available while the catalog is missing', async () => {
    mockGetFeatures.mockResolvedValue({
      features: ['create_only'],
      schedulerAlive: false,
      profile: null,
    })
    const conflictIds = new Set(['wf-a'])
    const other = renderIdProbe({ id: 'wf-b', existingIds: null, conflictIds })
    await waitFor(() =>
      expect(other.getByTestId('id').dataset['id']).toBe('unknown'),
    )
    cleanup()
    const same = renderIdProbe({ id: 'wf-a', existingIds: null, conflictIds })
    await waitFor(() =>
      expect(same.getByTestId('id').dataset['id']).toBe('taken'),
    )
  })

  it('keeps the id unknown while the features query is loading', async () => {
    mockGetFeatures.mockReturnValue(new Promise(() => {}))
    const { getByTestId } = renderIdProbe({
      id: 'wf-b',
      existingIds: new Set(),
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(getByTestId('id').dataset['id']).toBe('unknown')
  })

  it('is available from the catalog once the features answer', async () => {
    mockGetFeatures.mockResolvedValue({
      features: [],
      schedulerAlive: false,
      profile: null,
    })
    const { getByTestId } = renderIdProbe({
      id: 'wf-b',
      existingIds: new Set(),
    })
    await waitFor(() =>
      expect(getByTestId('id').dataset['id']).toBe('available'),
    )
  })
})
