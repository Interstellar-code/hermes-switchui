// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HermesDocsLink } from './hermes-docs-link'

function renderLink(props: { path: string; label?: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HermesDocsLink {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            path: 'user-guide/docker.md',
            content: '# Docker backend\n\nRuns commands in a container.',
            liveUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/docker',
          }),
          { status: 200 },
        ),
      ),
    ),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HermesDocsLink', () => {
  it('does not fetch until opened', () => {
    renderLink({ path: 'user-guide/docker.md' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches and renders the doc content on click, with a live-docs fallback link', async () => {
    renderLink({ path: 'user-guide/docker.md', label: 'Docker docs' })

    fireEvent.click(screen.getByRole('button', { name: 'Docker docs' }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/hermes-docs?path=user-guide%2Fdocker.md',
    )
    await waitFor(() => expect(screen.getByText(/Runs commands in a container/)).toBeTruthy())
    expect(screen.getByRole('link', { name: /Open full docs/ })).toHaveProperty(
      'href',
      'https://hermes-agent.nousresearch.com/docs/user-guide/docker',
    )
  })

  it('shows a fallback message and live link when the local doc is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: 'Local Hermes docs are not installed on this machine.',
              liveUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/docker',
            }),
            { status: 200 },
          ),
        ),
      ),
    )

    renderLink({ path: 'user-guide/docker.md' })
    fireEvent.click(screen.getByRole('button', { name: 'Docs' }))

    await waitFor(() =>
      expect(screen.getByText(/not installed on this machine/)).toBeTruthy(),
    )
    expect(screen.getByRole('link', { name: /Open full docs/ })).toBeTruthy()
  })
})
