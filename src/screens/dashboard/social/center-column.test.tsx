// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CenterColumn } from './center-column'
import { mockDashboardSocial } from './mock'
import { stubFitGeometry, stubMatchMedia } from './fit-rows-test-utils'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const data = mockDashboardSocial

afterEach(() => {
  navigate.mockClear()
  cleanup()
  vi.unstubAllGlobals()
})

describe('CenterColumn', () => {
  it('links the 8 rings to their pages', () => {
    render(<CenterColumn data={data} />)
    const hrefs: Record<string, string> = {
      Chats: '/chat',
      'Needs you': '#needs',
      Workflows: '/workflows',
      Cron: '/jobs',
      Tasks: '/tasks',
      Memory: '/memory',
      'Self-improve': '/self-improve',
      Gateway: '/operations',
    }
    const main = screen.getByRole('main', { name: 'Act now' })
    for (const [label, href] of Object.entries(hrefs)) {
      const link = within(main).getByText(label).closest('a')
      expect(link?.getAttribute('href')).toBe(href)
    }
    expect(screen.getByTestId('count-ring-ok')).toBeTruthy()
  })

  it('renders rings without badges when counts is null', () => {
    render(<CenterColumn data={{ ...data, counts: null }} />)
    expect(screen.getByText('Chats')).toBeTruthy()
    expect(screen.queryByTestId('count-ring-ok')).toBeNull()
  })

  it('has the ask box and shortcut links', () => {
    render(<CenterColumn data={data} />)
    expect(screen.getByLabelText('Ask hermes-switch something…')).toBeTruthy()
    expect(screen.getByText('RUN WORKFLOW').getAttribute('href')).toBe(
      '/workflows',
    )
    expect(screen.getByText('ADD TASK').getAttribute('href')).toBe('/tasks')
  })

  const recentRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...data.recent![0],
      title: `row ${i}`,
      href: `/chat/${i}`,
    }))
  const recentRegion = () =>
    screen.getByRole('region', { name: /RECENT ACTIVITY/ })

  it('without ResizeObserver shows 5 recent rows (each a link) and a +N more line', () => {
    render(<CenterColumn data={{ ...data, recent: recentRows(7) }} />)
    const links = within(recentRegion()).getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(links[0].getAttribute('href')).toBe('/chat/0')
    expect(
      within(recentRegion()).getByText('+2 more · see all in Feed'),
    ).toBeTruthy()
  })

  it('maxRows pins the rendered recent rows and the +N more line', () => {
    render(
      <CenterColumn
        data={{ ...data, recent: recentRows(10) }}
        recentMaxRows={7}
      />,
    )
    expect(within(recentRegion()).getAllByRole('link')).toHaveLength(7)
    expect(
      within(recentRegion()).getByText('+3 more · see all in Feed'),
    ).toBeTruthy()
  })

  it('shows no +N more line when every row fits', () => {
    render(
      <CenterColumn
        data={{ ...data, recent: recentRows(4) }}
        recentMaxRows={9}
      />,
    )
    expect(within(recentRegion()).getAllByRole('link')).toHaveLength(4)
    expect(within(recentRegion()).queryByText(/more · see all/)).toBeNull()
  })

  it('measures the card: shows the rows that fit whole, minimum 3', () => {
    // 30px rows in a 140px box; one 20px line is kept for "+N more".
    const box = { height: 140 }
    const geo = stubFitGeometry(box)
    try {
      const { rerender } = render(
        <CenterColumn data={{ ...data, recent: recentRows(8) }} />,
      )
      expect(within(recentRegion()).getAllByRole('link')).toHaveLength(4)
      expect(
        within(recentRegion()).getByText('+4 more · see all in Feed'),
      ).toBeTruthy()
      // Tiny box: never fewer than 3 whole rows.
      box.height = 40
      rerender(<CenterColumn data={{ ...data, recent: recentRows(9) }} />)
      expect(within(recentRegion()).getAllByRole('link')).toHaveLength(3)
    } finally {
      geo.restore()
    }
  })

  it('single-column layout: no measuring, 5 rows in normal flow plus +N more', () => {
    const geo = stubFitGeometry({ height: 400 })
    stubMatchMedia(true)
    try {
      render(<CenterColumn data={{ ...data, recent: recentRows(10) }} />)
      expect(within(recentRegion()).getAllByRole('link')).toHaveLength(5)
      expect(
        within(recentRegion()).getByText('+5 more · see all in Feed'),
      ).toBeTruthy()
      expect(recentRegion().querySelector('.absolute')).toBeNull()
      expect(geo.observers).toHaveLength(0)
    } finally {
      geo.restore()
    }
  })

  it('re-measures when the rows change but their count does not', () => {
    const geo = stubFitGeometry({ height: 140 })
    try {
      const rows = recentRows(8)
      const { rerender } = render(
        <CenterColumn data={{ ...data, recent: rows }} />,
      )
      expect(within(recentRegion()).getAllByRole('link')).toHaveLength(4)
      // Same count, but every row is now taller: only 2 fit, min 3 wins.
      geo.restore()
      const tall = stubFitGeometry({ height: 140 }, 60)
      try {
        rerender(
          <CenterColumn
            data={{
              ...data,
              recent: rows.map((r) => ({ ...r, sub: `${r.sub} (longer)` })),
            }}
          />,
        )
        expect(within(recentRegion()).getAllByRole('link')).toHaveLength(3)
      } finally {
        tall.restore()
      }
    } finally {
      geo.restore()
    }
  })

  it('disconnects the observer on unmount', () => {
    const geo = stubFitGeometry({ height: 140 })
    try {
      const { unmount } = render(
        <CenterColumn data={{ ...data, recent: recentRows(8) }} />,
      )
      expect(geo.observers).toHaveLength(1)
      unmount()
      expect(geo.observers[0].disconnect).toHaveBeenCalledTimes(1)
    } finally {
      geo.restore()
    }
  })

  it('the Recent card grows to fill its column', () => {
    render(<CenterColumn data={data} />)
    expect(recentRegion().className).toContain('flex-1')
    expect(screen.getByRole('main', { name: 'Act now' }).className).toContain(
      'self-stretch',
    )
  })

  it('shows empty and unavailable states', () => {
    const { rerender } = render(
      <CenterColumn data={{ ...data, needsYou: [], recent: [] }} />,
    )
    expect(screen.getByText(/All caught up/)).toBeTruthy()
    rerender(<CenterColumn data={{ ...data, needsYou: null, recent: null }} />)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  })

  it('renders each needs-you kind', () => {
    render(<CenterColumn data={data} />)
    expect(screen.getByText('release-train is waiting for you')).toBeTruthy()
    expect(screen.getByText('APPROVAL')).toBeTruthy()
    expect(
      screen.getByText('nightly-digest failed 3 runs in a row'),
    ).toBeTruthy()
    expect(
      screen.getAllByText('gateway timeout after 30s').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('OPEN IN CONDUCTOR →').getAttribute('href')).toBe(
      '/conductor',
    )
    expect(screen.getByText('VIEW LOG').getAttribute('href')).toBe('/jobs')
    expect(screen.getByText('OPEN CARD').getAttribute('href')).toBe('/tasks')
    expect(screen.queryByText(/MARK REVIEWED/)).toBeNull()
  })

  it('approves from the dialog, updates the row and calls onChanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<CenterColumn data={data} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE…' }))
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Approved — resuming')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/workflow-runs/run_8f2a/approve')
    expect(JSON.parse(init.body)).toEqual({
      node_run_id: 'node_8f2a_4',
      decision: 'approved',
      response: '',
    })
  })

  it('Escape closes the dialog and focus returns to APPROVE…', () => {
    render(<CenterColumn data={data} />)
    const opener = screen.getByRole('button', { name: 'APPROVE…' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('retries a failing cron job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    render(<CenterColumn data={data} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'RETRY NOW' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/claude-jobs/cron_31?action=run')
    expect(init.method).toBe('POST')
  })

  it('shows the error when retry fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"not supported"}', { status: 501 }),
        ),
    )
    render(<CenterColumn data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'RETRY NOW' }))
    expect((await screen.findByRole('alert')).textContent).toBe('not supported')
  })
})

const approval = {
  kind: 'approval' as const,
  runId: 'run_1',
  nodeRunId: 'node_1',
  workflow: 'deploy',
  version: 'v1',
  pausedAt: 'approval-gate',
  progress: '4 of 7 nodes done',
  next: 'Ship',
  agent: 'morpheus',
  at: new Date(Date.now() - 6 * 60000).toISOString(),
}
const approvalData = { ...data, needsYou: [approval] }

describe('CenterColumn review fixes', () => {
  it('wraps the rings in a labelled nav', () => {
    render(<CenterColumn data={data} />)
    expect(screen.getByRole('navigation', { name: 'Jump to' })).toBeTruthy()
  })

  it('shows node name, age and agent for an approval', () => {
    render(<CenterColumn data={approvalData} />)
    expect(
      screen.getByText(
        'paused at approval-gate · 4 of 7 nodes done · 6m ago · morpheus',
      ),
    ).toBeTruthy()
  })

  it('moves focus to the status text after a decision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"ok":true}')),
    )
    render(<CenterColumn data={approvalData} />)
    fireEvent.click(screen.getByRole('button', { name: 'REJECT…' }))
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'no' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM REJECT' }))
    const status = await screen.findByText('Rejected')
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it('locks row buttons and sends one POST while a request is in flight', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<CenterColumn data={approvalData} />)
    fireEvent.click(screen.getByRole('button', { name: 'APPROVE…' }))
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'APPROVE…' })
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(
      screen.getByRole('button', { name: 'REJECT…' }).hasAttribute('disabled'),
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'CONFIRM APPROVE' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ask box ignores empty input and navigates with the router', () => {
    render(<CenterColumn data={data} />)
    const input = screen.getByLabelText('Ask hermes-switch something…')
    fireEvent.submit(input)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input)
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.submit(input)
    expect(navigate).toHaveBeenCalledWith({
      to: '/chat/$sessionKey',
      params: { sessionKey: 'new' },
    })
  })

  it('retry sends a JSON content type and disables the button while pending', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<CenterColumn data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'RETRY NOW' }))
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'RETRY NOW' })
          .hasAttribute('disabled'),
      ).toBe(true),
    )
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
    })
  })

  it('retry shows an error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    render(<CenterColumn data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'RETRY NOW' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Network error. Try again.',
    )
  })
})
