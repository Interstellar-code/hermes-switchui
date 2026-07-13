// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineClarifyCard } from './inline-clarify-card'
import type { PendingClarify } from '../../../stores/chat-store'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

const clarify = (choices: Array<string> | null): PendingClarify => ({
  clarifyId: 'clarify-1',
  interactionId: 'interaction-1',
  question: 'Pick one',
  choices,
  runId: 'run-1',
  requestedAt: 1,
})

describe('InlineClarifyCard', () => {
  it('selects a choice before Continue submits its exact answer', () => {
    render(<InlineClarifyCard clarify={clarify(['First', 'Second'])} sessionKey="session-1" />)

    const first = screen.getByRole('button', { name: /First/ })
    fireEvent.click(first)
    expect(first.getAttribute('aria-pressed')).toBe('true')
    expect(fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/session-1/chat/interactions/interaction-1/respond',
      expect.objectContaining({ body: JSON.stringify({ answer: 'First' }) }),
    )
  })

  it('keeps Other mutually exclusive and submits trimmed custom text once', () => {
    let resolveFetch!: (value: { ok: boolean }) => void
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    render(<InlineClarifyCard clarify={clarify(['First', 'Second'])} sessionKey="session-1" />)

    fireEvent.click(screen.getByRole('button', { name: /First/ }))
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Other/ }))
    expect(screen.getByRole('button', { name: /First/ }).getAttribute('aria-pressed')).toBe('false')
    const input = screen.getByRole('textbox', { name: 'Clarification answer' })
    fireEvent.change(input, { target: { value: '  Custom  ' } })
    const submit = screen.getByRole('button', { name: 'Continue' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ answer: 'Custom' }) }),
    )
    resolveFetch({ ok: true })
  })

  it('shows free text immediately for an open question', () => {
    render(<InlineClarifyCard clarify={clarify(null)} sessionKey="session-1" />)

    expect(screen.getByRole('textbox', { name: 'Clarification answer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Other/ })).toBeNull()
  })
})
