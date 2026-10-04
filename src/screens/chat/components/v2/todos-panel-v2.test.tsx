// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { TodosPanelV2, todoProgress } from './todos-panel-v2'
import type { FlatToolEntry } from './tool-entries'

const todos = [
  { id: '1', content: 'a done', status: 'completed' },
  { id: '2', content: 'b doing', status: 'in_progress' },
  { id: '3', content: 'c pending', status: 'pending' },
  { id: '4', content: 'd pending', status: 'pending' },
  { id: '5', content: 'e dropped', status: 'cancelled' },
]

function entry(n: number, over: Partial<FlatToolEntry> = {}): FlatToolEntry {
  return {
    key: `k${n}`,
    isCall: true,
    name: 'todo',
    callId: `c${n}`,
    timestamp: n,
    output: JSON.stringify({ todos, summary: { total: 5 } }),
    ...over,
  }
}

function render(entries: Array<FlatToolEntry>): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  act(() => {
    createRoot(el).render(<TodosPanelV2 entries={entries} />)
  })
  return el
}

describe('todoProgress', () => {
  it('counts statuses and updates', () => {
    expect(todoProgress([entry(1), entry(2)])).toEqual({
      done: 1,
      total: 5,
      inProgress: 1,
      pending: 2,
      cancelled: 1,
      updates: 2,
      updating: false,
    })
  })
  it('returns null with no calls or unreadable merge output', () => {
    expect(todoProgress([])).toBeNull()
    expect(
      todoProgress([
        entry(1, { output: 'oops', input: { todos: [], merge: true } }),
      ]),
    ).toBeNull()
  })
})

describe('TodosPanelV2', () => {
  it('renders sections, caption, progressbar, footer', () => {
    const el = render([entry(1), entry(2)])
    const bar = el.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('5')
    expect(el.textContent).toContain('1 done · 1 in progress · 2 pending')
    expect(el.textContent).toContain('In progress (1)')
    expect(el.textContent).toContain('b doing')
    expect(el.textContent).toContain('c pending')
    expect(el.textContent).toContain('Latest of 2 updates')
  })
  it('collapses Done and Cancelled until toggled', () => {
    const el = render([entry(1)])
    expect(el.textContent).not.toContain('a done')
    const btn = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Done'),
    )!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    act(() => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('a done')
    expect(el.querySelector('.line-through')).not.toBeNull()
    expect(el.textContent).not.toContain('e dropped')
  })
  it('uses the output list for a merge-mode newest call', () => {
    const el = render([
      entry(1),
      entry(2, {
        input: {
          todos: [{ content: 'patch only', status: 'pending' }],
          merge: true,
        },
      }),
    ])
    expect(el.textContent).toContain('c pending')
    expect(el.textContent).not.toContain('patch only')
  })
  it('shows unreadable message with count', () => {
    const el = render([
      entry(1, { output: 'x', input: { todos: [], merge: true } }),
    ])
    expect(el.textContent).toContain("Latest update couldn't be read")
    expect(el.textContent).toContain('1 update')
  })
  it('shows empty state', () => {
    expect(render([]).textContent).toBe('No to-do list in this session')
  })
  it('running newest merge call: shows last settled list with Updating…', () => {
    const running = entry(2, {
      output: undefined,
      input: {
        todos: [{ content: 'patch only', status: 'pending' }],
        merge: true,
      },
    })
    expect(todoProgress([entry(1), running])).toMatchObject({
      done: 1,
      total: 5,
      updating: true,
    })
    const el = render([entry(1), running])
    expect(el.textContent).toContain('c pending')
    expect(el.textContent).not.toContain('patch only')
    expect(el.textContent).toContain('Updating…')
    expect(el.textContent).not.toContain("couldn't be read")
  })
  it('only call still running: Updating…, not unreadable', () => {
    const el = render([entry(1, { output: undefined, input: { merge: true } })])
    expect(el.textContent).toBe('Updating…')
  })
  it('empty todo list: no progressbar, empty note', () => {
    const el = render([entry(1, { output: JSON.stringify({ todos: [] }) })])
    expect(
      todoProgress([entry(1, { output: JSON.stringify({ todos: [] }) })])
        ?.total,
    ).toBe(0)
    expect(el.querySelector('[role="progressbar"]')).toBeNull()
    expect(el.textContent).toContain('The to-do list is empty')
  })
})
