// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { McpPanelV2, groupMcpByServer, mcpServerCount } from './mcp-panel-v2'
import type { FlatToolEntry } from './tool-entries'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(() => vi.restoreAllMocks())

const e = (
  name: string,
  extra: Partial<FlatToolEntry> = {},
): FlatToolEntry => ({
  key: `${name}-${Math.random()}`,
  isCall: true,
  name,
  callId: name,
  ...extra,
})

function render(ui: React.ReactElement): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  act(() => createRoot(c).render(ui))
  return c
}

describe('groupMcpByServer', () => {
  it('groups both name styles incl. hyphenated servers, errors first', () => {
    const entries = [
      e('mcp__github__search'),
      e('mcp__github__search'),
      e('mcp_my_srv_do_thing', {
        output: '{"error":"boom\\nline2"}',
        timestamp: 1,
      }),
      e('read_file'),
    ]
    const g = groupMcpByServer(entries, ['github', 'my-srv'])
    expect(g.map((x) => x.server)).toEqual(['my-srv', 'github'])
    expect(g[0]).toMatchObject({ errors: 1, lastError: 'boom' })
    expect(g[0].tools[0].tool).toBe('do_thing')
    expect(g[1]).toMatchObject({
      calls: 2,
      tools: [{ tool: 'search', count: 2 }],
    })
    expect(mcpServerCount(entries, ['github', 'my-srv'])).toBe(2)
  })
})

describe('bare MCP tool names', () => {
  it('resolves unprefixed tools to their server via the tool map', () => {
    const toolServers = new Map([['web_search_prime', 'zai-search']])
    const entries = [
      e('web_search_prime'),
      e('Web_Search_Prime'),
      e('read_file'),
    ]
    const g = groupMcpByServer(entries, ['zai-search'], toolServers)
    expect(g).toEqual([
      expect.objectContaining({
        server: 'zai-search',
        calls: 2,
      }),
    ])
    expect(mcpServerCount(entries, ['zai-search'], toolServers)).toBe(1)
    expect(mcpServerCount(entries, ['zai-search'])).toBe(0)
  })
})

describe('McpPanelV2', () => {
  it('hides unknown status, shows known chip and error line', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const c = render(
      <McpPanelV2
        entries={[
          e('mcp__a__x', { output: '{"error":"bad"}' }),
          e('mcp__b__y'),
        ]}
        servers={[
          { name: 'a', status: 'failed' },
          { name: 'b', status: 'unknown' },
        ]}
      />,
    )
    const text = c.textContent
    expect(text).toContain('failed') // chip
    expect(text).toContain('bad')
    expect(text).not.toContain('unknown')
    expect(c.querySelector('a')?.getAttribute('href')).toBe('/mcp')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not use server.lastError without a session error', () => {
    const c = render(
      <McpPanelV2
        entries={[e('mcp__a__x')]}
        servers={[{ name: 'a', status: 'connected', lastError: 'stale' }]}
      />,
    )
    expect(c.textContent).not.toContain('stale')
    expect(c.textContent).toContain('connected')
  })

  it('shows load_mcp note', () => {
    const c = render(
      <McpPanelV2
        entries={[
          e('load_mcp_server', { input: { server_names: ['github'] } }),
        ]}
      />,
    )
    expect(c.textContent).toContain('Loaded this session: github')
    expect(c.textContent).toContain('No MCP calls in this session')
  })

  it('empty state', () => {
    const c = render(<McpPanelV2 entries={[]} />)
    expect(c.textContent).toContain('No MCP calls in this session')
  })
})
