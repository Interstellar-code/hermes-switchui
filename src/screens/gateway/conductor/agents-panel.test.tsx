// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentsPanel } from './agents-panel'
import fixture from './__fixtures__/run-sessions.json'

let resp: { available: boolean; data: unknown } = {
  available: true,
  data: fixture,
}
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params: Record<string, string>
    search: { profile?: string }
    children: React.ReactNode
  }) => (
    <a
      {...rest}
      href={`${to.replace('$sessionKey', params.sessionKey)}${search.profile ? `?profile=${search.profile}` : ''}`}
    >
      {children}
    </a>
  ),
}))
vi.mock('./use-conductor-queries', () => ({
  useRunSessions: () => ({ data: resp, isLoading: false, isError: false }),
  useConductorScheduled: () => ({ data: { profile: 'hermes-switch' } }),
}))

describe('AgentsPanel', () => {
  afterEach(cleanup)

  it('renders owner, node session, nested sub-agents and delegation', () => {
    resp = { available: true, data: fixture }
    render(<AgentsPanel runId="r1" />)
    const owner = screen.getByText('Fix the build')
    expect(owner.getAttribute('href')).toBe(
      '/chat/chat-owner-1?profile=hermes-switch',
    )
    expect(screen.getByText('Analyze step')).toBeTruthy()
    expect(screen.getByText('Explore repo')).toBeTruthy()
    expect(screen.getByText('sub-1a')).toBeTruthy() // untitled -> id slice
    expect(screen.getByText(/Summarise failing tests/)).toBeTruthy()
    expect(screen.getAllByText(/ended · complete/)).toHaveLength(2)
  })

  it('shows the patch hint when the backend lacks the endpoint', () => {
    resp = { available: false, data: null }
    render(<AgentsPanel runId="r1" />)
    expect(screen.getByText(/No linked agent sessions/)).toBeTruthy()
    expect(screen.getByText(/run-sessions patch/)).toBeTruthy()
  })
})
