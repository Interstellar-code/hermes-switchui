// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { ToolPanelV2 } from './tool-panel-v2'
import type { Root } from 'react-dom/client'
import type { FlatToolEntry } from './tool-entries'

const { label } = vi.hoisted(() => ({
  label: (name: string, args?: unknown) => (args ? `${name}+args` : name),
}))
vi.mock('../streaming-activity-ui', () => ({
  formatStreamingActivityLabel: label,
}))

let n = 0
const mk = (name: string, o: Partial<FlatToolEntry> = {}): FlatToolEntry => ({
  key: `k${n++}`,
  isCall: true,
  name,
  callId: `c${n}`,
  input: { note: `${name}-${n}` },
  output: 'ok',
  timestamp: n,
  displayTs: Date.now(),
  ...o,
})

let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
})
function render(props: React.ComponentProps<typeof ToolPanelV2>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ToolPanelV2 {...props} />))
  return host
}
const btn = (c: HTMLElement, text: RegExp) =>
  [...c.querySelectorAll('button')].find((b) => text.test(b.textContent))!
const click = (el: Element) => act(() => void fireEvent.click(el))

describe('ToolPanelV2', () => {
  it('groups by name with counts and errors; errors section first', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const c = render({
      entries: [
        mk('alpha'),
        mk('alpha'),
        mk('beta', { isError: true, output: '{"error":"boom"}' }),
      ],
    })
    expect(btn(c, /alpha/).textContent).toContain('×2')
    expect(btn(c, /beta/).textContent).toContain('1 err')
    const heads = [...c.querySelectorAll('h3')].map((h) => h.textContent)
    expect(heads).toEqual(['Needs attention', 'All tools'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('chips filter, including errors', () => {
    const c = render({
      entries: [mk('alpha'), mk('beta', { isError: true, output: 'x' })],
    })
    click(btn(c, /^errors 1/))
    expect(btn(c, /^errors 1/).getAttribute('aria-pressed')).toBe('true')
    expect(c.textContent).not.toContain('alpha')
    expect(c.textContent).toContain('beta')
  })

  it('search matches output; Esc clears', () => {
    const c = render({
      entries: [mk('alpha', { output: 'needle' }), mk('beta')],
    })
    const input = c.querySelector('input')!
    act(() => void fireEvent.change(input, { target: { value: 'needle' } }))
    expect(c.textContent).toContain('alpha')
    expect(c.textContent).not.toContain('beta')
    act(() => void fireEvent.keyDown(input, { key: 'Escape' }))
    expect(c.textContent).toContain('beta')
  })

  it('expand shows 20 then Show N more', () => {
    const c = render({ entries: Array.from({ length: 25 }, () => mk('alpha')) })
    const g = btn(c, /alpha/)
    expect(g.getAttribute('aria-expanded')).toBe('false')
    click(g)
    expect(c.querySelectorAll('[data-testid="call-dot"]').length).toBe(20)
    click(btn(c, /Show 5 more/))
    expect(c.querySelectorAll('[data-testid="call-dot"]').length).toBe(25)
  })

  it('empty vs no-matches; capped footer only when set', () => {
    let c = render({ entries: [] })
    expect(c.textContent).toContain('No tool calls yet')
    expect(c.textContent).not.toContain('latest 150')
    act(() => root?.unmount())
    c = render({ entries: [mk('alpha')], historyCapped: true })
    act(
      () =>
        void fireEvent.change(c.querySelector('input')!, {
          target: { value: 'zzz' },
        }),
    )
    expect(c.textContent).toContain('No matches')
    expect(c.textContent).toContain('Covers the latest 150 messages')
  })

  it('group label ignores args, so calls with different args share one label', () => {
    const c = render({
      entries: [
        mk('alpha', { input: { path: 'a' } }),
        mk('alpha', { input: { path: 'b' } }),
      ],
    })
    const g = btn(c, /alpha/)
    expect(g.textContent).toContain('alpha')
    expect(g.textContent).not.toContain('+args')
  })

  it('groups under Needs attention are not repeated under All tools', () => {
    const c = render({
      entries: [mk('alpha'), mk('beta', { isError: true, output: 'x' })],
    })
    const groupButtons = [...c.querySelectorAll('button[aria-expanded]')]
    expect(groupButtons.map((b) => b.textContent.includes('beta'))).toEqual([
      true,
      false,
    ])
    const all = c.querySelector('[aria-label="All tools"]')!
    expect(all.textContent).toContain('alpha')
    expect(all.textContent).not.toContain('beta')
  })

  it('resets the active chip to all when it disappears', () => {
    const c = render({
      entries: [mk('alpha'), mk('beta', { isError: true, output: 'x' })],
    })
    click(btn(c, /^errors 1/))
    act(() => root!.render(<ToolPanelV2 entries={[mk('alpha')]} />))
    expect(btn(c, /^all$/).getAttribute('aria-pressed')).toBe('true')
    expect(c.textContent).toContain('alpha')
  })
})
