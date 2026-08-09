// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/require-await -- Response.json mocks intentionally match the async browser API. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { INITIAL_DRAFT } from '../types'
import { WizardStepToolset } from './wizard-step-toolset'
import type { NewAgentDraft } from '../types'

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response)
}

function draft(patch: Partial<NewAgentDraft> = {}): NewAgentDraft {
  return { ...INITIAL_DRAFT, ...patch }
}

function renderStep(d: NewAgentDraft) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <WizardStepToolset draft={d} errors={[]} onChange={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WizardStepToolset suppressed-toolset detection', () => {
  it('flags a toolset shown as enabled that the live gateway reports as suppressed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          source: 'gateway',
          toolsets: [
            {
              key: 'terminal',
              label: 'Terminal & Processes',
              group: 'Core',
              destructive: true,
              plugin: false,
              gatewayEnabled: false,
            },
          ],
        }),
      ),
    )

    renderStep(draft({ disabled_toolsets: [] }))

    await waitFor(() => expect(screen.getByText(/suppressed by the gateway/i)).toBeTruthy())
    expect(screen.getAllByTitle(/Suppressed by the gateway's current config/).length).toBeGreaterThan(0)
  })

  it('does not flag a toolset the draft already disabled — no contradiction to surface', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          source: 'gateway',
          toolsets: [
            {
              key: 'terminal',
              label: 'Terminal & Processes',
              group: 'Core',
              destructive: true,
              plugin: false,
              gatewayEnabled: false,
            },
          ],
        }),
      ),
    )

    renderStep(draft({ disabled_toolsets: ['terminal'] }))

    await waitFor(() => expect(screen.getByText('Terminal & Processes')).toBeTruthy())
    expect(screen.queryByText(/suppressed by the gateway/i)).toBeNull()
  })

  it('says nothing on the static fallback even when nothing is disabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('gateway unreachable'))),
    )

    renderStep(draft({ disabled_toolsets: [] }))

    await waitFor(() => expect(screen.getByText('File Operations')).toBeTruthy())
    expect(screen.queryByText(/suppressed by the gateway/i)).toBeNull()
  })
})
