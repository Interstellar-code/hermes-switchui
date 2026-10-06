// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NodeLog, countLines, logSegments } from './node-log'
import type { LogChunk, NodeLogState } from './use-node-log'

const h = vi.hoisted(() => {
  const state: { current: object } = { current: {} }
  return state
})
vi.mock('@/styles/node-log.css', () => ({}))
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))
vi.mock('./use-node-log', () => ({
  useNodeLog: () => h.current,
}))

const chunk = (
  seq: number,
  text: string,
  extra: Partial<LogChunk> = {},
): LogChunk => ({
  key: String(seq),
  seq,
  ord: seq,
  stream: 'stdout',
  text,
  first: false,
  truncated: false,
  ...extra,
})

function setLog(patch: Partial<NodeLogState>) {
  h.current = {
    chunks: [],
    loading: false,
    error: false,
    hasEarlier: false,
    loadingEarlier: false,
    dropped: false,
    loadEarlier: vi.fn(),
    ...patch,
  }
}

afterEach(cleanup)

describe('logSegments', () => {
  it('merges same-stream runs and inserts attempt / truncation dividers', () => {
    const segs = logSegments([
      chunk(1, 'a\n', { first: true }),
      chunk(2, 'b\n'),
      chunk(3, 'e\n', { stream: 'stderr' }),
      chunk(4, '', { truncated: true }),
      chunk(5, 'c\n', { first: true }),
    ])
    expect(segs.map((s) => s.text)).toEqual([
      'a\nb\n',
      'e\n',
      '── truncated at 256KB by the engine ──\n',
      '── attempt 2 ──\n',
      'c\n',
    ])
    expect(countLines([chunk(1, 'a\nb'), chunk(2, 'c\n')])).toBe(2)
    expect(countLines([chunk(1, 'a\nb')])).toBe(2)
  })
})

describe('NodeLog', () => {
  it('log box is aria-live off; a polite status region announces state only', () => {
    setLog({ chunks: [chunk(1, 'hello\n')] })
    const { rerender } = render(<NodeLog runId="r" nodeRunId="n" live />)
    const box = screen.getByRole('log')
    expect(box.getAttribute('aria-live')).toBe('off')
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')
    rerender(<NodeLog runId="r" nodeRunId="n" live={false} />)
    expect(status.textContent).toBe('LOG finished · 1 line')
  })

  it('renders the attempt divider', () => {
    setLog({
      chunks: [
        chunk(1, 'one\n', { first: true }),
        chunk(2, 'two\n', { first: true }),
      ],
    })
    render(<NodeLog runId="r" nodeRunId="n" live={false} />)
    expect(screen.getByText(/── attempt 2 ──/)).toBeTruthy()
  })

  it('empty states', () => {
    setLog({ loading: true })
    const { rerender } = render(<NodeLog runId="r" nodeRunId="n" live />)
    expect(screen.getByText('Loading output…')).toBeTruthy()
    setLog({})
    rerender(<NodeLog runId="r" nodeRunId="n2" live />)
    expect(screen.getByText('Waiting for output…')).toBeTruthy()
    setLog({})
    rerender(<NodeLog runId="r" nodeRunId="n3" live={false} />)
    expect(
      screen.getByText('No output was captured for this step.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'COPY' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('scrolling up pauses FOLLOW; back at the bottom resumes it', () => {
    setLog({ chunks: [chunk(1, 'x\n')] })
    render(<NodeLog runId="r" nodeRunId="n" live />)
    const box = screen.getByRole('log')
    Object.defineProperty(box, 'scrollHeight', {
      value: 1000,
      configurable: true,
    })
    Object.defineProperty(box, 'clientHeight', {
      value: 100,
      configurable: true,
    })
    const follow = screen.getByRole('button', { name: 'FOLLOW' })
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    box.scrollTop = 200
    fireEvent.scroll(box)
    expect(follow.getAttribute('aria-pressed')).toBe('false')
    box.scrollTop = 900
    fireEvent.scroll(box)
    expect(follow.getAttribute('aria-pressed')).toBe('true')
  })

  it('LOAD EARLIER OUTPUT calls loadEarlier', () => {
    setLog({ chunks: [chunk(5, 'x\n')], hasEarlier: true })
    render(<NodeLog runId="r" nodeRunId="n" live={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'LOAD EARLIER OUTPUT' }))
    expect(
      (h.current as { loadEarlier: () => void }).loadEarlier,
    ).toHaveBeenCalled()
  })
})
