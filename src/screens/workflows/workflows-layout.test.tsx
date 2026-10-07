// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { WorkflowsLayout } from './workflows-layout'
import type { WorkflowSummary } from './types'

// Child screens are stubbed: this test is about layout state (URL ⇄ view).
vi.mock('./workflow-library', () => ({
  WorkflowLibrary: () => <div data-testid="library" />,
}))
vi.mock('./workflows-top-bar', () => ({
  WorkflowsTopBar: () => <div data-testid="top-bar" />,
}))
vi.mock('./workflow-grid', () => ({
  WorkflowGrid: ({
    onSelect,
    onEdit,
  }: {
    onSelect: (id: string) => void
    onEdit: (id: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect('wf-a')}>
        OPEN WF-A
      </button>
      <button type="button" onClick={() => onEdit('wf-a')}>
        EDIT WF-A
      </button>
    </div>
  ),
}))
vi.mock('./workflow-detail', () => ({
  WorkflowDetail: ({ workflowId }: { workflowId: string }) => (
    <div data-testid={`detail-${workflowId}`} />
  ),
}))
// Stub editor: always dirty, its leave guard asks window.confirm.
vi.mock('./graph-editor/graph-editor', async () => {
  const React = await import('react')
  return {
    WorkflowGraphEditor: ({
      onRegisterGuard,
    }: {
      onRegisterGuard?: (g: (() => boolean) | null) => void
    }) => {
      React.useEffect(() => {
        onRegisterGuard?.(() => window.confirm('Discard?'))
        return () => onRegisterGuard?.(null)
      }, [onRegisterGuard])
      return <div data-testid="graph-editor" />
    },
  }
})
vi.mock('./launch-wizard', () => ({
  LaunchWizard: () => null,
}))
vi.mock('./run-detail-panel', () => ({
  RunDetailPanel: () => null,
}))

vi.mock('./use-workflows', () => ({
  useWorkflowDefinitions: () => ({
    data: [] as Array<WorkflowSummary>,
    error: null,
    refetch: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('WorkflowsLayout URL ⇄ view', () => {
  it('opens a workflow via ?wf= and restores browse mode on Back (popstate)', async () => {
    window.history.replaceState(null, '', '/workflows')
    render(<WorkflowsLayout />)
    expect(screen.queryByTestId('detail-wf-a')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'OPEN WF-A' }))
    expect(screen.getByTestId('detail-wf-a')).toBeTruthy()
    expect(new URLSearchParams(window.location.search).get('wf')).toBe('wf-a')

    // browser Back: URL loses ?wf → popstate → browse view returns
    window.history.back()
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('wf')).toBeNull(),
    )
    expect(screen.queryByTestId('detail-wf-a')).toBeNull()
  })

  it('Back with a dirty editor confirms once; cancel keeps the editor and URL', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    window.history.replaceState(null, '', '/workflows?run=r1')
    render(<WorkflowsLayout />)
    fireEvent.click(screen.getByRole('button', { name: 'EDIT WF-A' }))
    expect(screen.getByTestId('graph-editor')).toBeTruthy()
    expect(window.location.search).toBe('?run=r1&wf=wf-a')

    window.history.back()
    // the guard cancels → history.go(1) restores the exact URL
    await waitFor(() => expect(window.location.search).toBe('?run=r1&wf=wf-a'))
    await new Promise((r) => setTimeout(r, 30))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('graph-editor')).toBeTruthy()

    // confirm → Back proceeds
    confirmSpy.mockReturnValue(true)
    window.history.back()
    await waitFor(() => expect(screen.queryByTestId('graph-editor')).toBeNull())
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(window.location.search).toBe('?run=r1')
    confirmSpy.mockRestore()
  })

  it('reads ?wf= on initial mount', () => {
    window.history.replaceState(null, '', '/workflows?wf=wf-b')
    render(<WorkflowsLayout />)
    expect(screen.getByTestId('detail-wf-b')).toBeTruthy()
  })
})
