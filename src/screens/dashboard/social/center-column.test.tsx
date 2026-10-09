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

const data = mockDashboardSocial

afterEach(() => {
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

  it('shows at most 5 recent rows, each a link', () => {
    const base = data.recent![0]
    const recent = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      title: `row ${i}`,
      href: `/chat/${i}`,
    }))
    render(<CenterColumn data={{ ...data, recent }} />)
    const list = screen.getByRole('region', { name: /RECENT ACTIVITY/ })
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(5)
    expect(links[0].getAttribute('href')).toBe('/chat/0')
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
