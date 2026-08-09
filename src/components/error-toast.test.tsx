// @vitest-environment jsdom
/**
 * classifyError() maps raw chat-send failure text to a user-facing toast
 * message. There are three distinct trust boundaries that can produce an
 * authentication-shaped failure — browser→workspace (HERMES_PASSWORD /
 * session token), workspace→gateway (HERMES_API_TOKEN / API_SERVER_KEY),
 * and gateway→provider (the provider's own key) — and a mismatched
 * workspace→gateway token produces the exact same `invalid_api_key` shape a
 * bad provider key does (see openai-compat-api.ts's getBearerToken() doc
 * comment). The message must not confidently name the wrong secret, and
 * must only point at a Settings destination that actually exists.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { ErrorToastContainer, showErrorToast } from './error-toast'

afterEach(() => {
  cleanup()
})

function renderContainer() {
  return render(<ErrorToastContainer />)
}

describe('classifyError (via showErrorToast)', () => {
  it('names both real secrets for a 401 instead of only the provider key', () => {
    renderContainer()
    act(() => {
      showErrorToast('OpenAI-compatible chat: 401 {"error":{"message":"invalid_api_key"}}')
    })

    const toastText = screen.getByRole('alert').textContent
    expect(toastText).toMatch(/HERMES_API_TOKEN/)
    expect(toastText).toMatch(/provider API key/i)
    // Must not assert the old, overconfident wording that named only the
    // provider key and pointed at a generic, nonexistent "Settings" screen.
    expect(toastText).not.toBe('Authentication error — check your API key in Settings')
  })

  it('points at the Settings section that actually exists', () => {
    renderContainer()
    act(() => {
      showErrorToast('403 Forbidden')
    })

    const toastText = screen.getByRole('alert').textContent
    expect(toastText).toMatch(/Settings.*API Keys/)
  })

  it('still classifies rate limiting separately from auth errors', () => {
    renderContainer()
    act(() => {
      showErrorToast('429 Too Many Requests')
    })

    const toastText = screen.getByRole('alert').textContent
    expect(toastText).toMatch(/Rate limited/)
  })
})
