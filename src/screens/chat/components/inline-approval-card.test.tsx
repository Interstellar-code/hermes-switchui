// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../../stores/chat-store'
import { InlineClarifyCard } from './inline-clarify-card'
import type { PendingClarify } from '../../../stores/chat-store'
import type { PendingApprovalDetail } from '@/lib/approvals'

/**
 * Fixtures are shaped exactly as approval contract v1 §1, including the three
 * `choices` variants `_approval_event_choices` can produce. The card renders
 * from `choices` and never hardcodes the set, so all three must work.
 */

const SESSION = 'sess-a'

function detail(over: Partial<PendingApprovalDetail> = {}): PendingApprovalDetail {
  return {
    runId: 'run_1111',
    command: 'cp ./x /etc/systemd/system/x.service',
    description: 'copy/move file into system config path',
    patternKeys: ['shell-c', 'file-write-system'],
    allowPermanent: true,
    ...over,
  }
}

function card(
  over: Partial<PendingClarify> = {},
  approvalOver: Partial<PendingApprovalDetail> = {},
): PendingClarify {
  return {
    clarifyId: 'approval_ab12cd34ef',
    kind: 'approval',
    toolName: 'approval',
    question: 'copy/move file into system config path',
    choices: ['once', 'session', 'always', 'deny'],
    approval: detail(approvalOver),
    runId: 'run_1111',
    requestedAt: 1,
    ...over,
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

beforeEach(() => {
  useChatStore.setState({ pendingClarify: {} })
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, resolved: 1 })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useChatStore.setState({ pendingClarify: {} })
})

describe('approval routing', () => {
  it('routes an approval-kind clarify to the decision card, not the clarify card', () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    expect(screen.getByText('Approval required')).toBeTruthy()
    // The clarify card's free-text escape is meaningless for a decision.
    expect(screen.queryByRole('button', { name: 'Other' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('leaves a historical approval RECEIPT on the ordinary clarify card', () => {
    // `interactionReceiptToPendingClarify` sets kind:'approval' with no
    // `approval` payload — there is nothing to decide.
    render(
      <InlineClarifyCard
        clarify={{
          clarifyId: 'c1',
          kind: 'approval',
          question: 'Ran it?',
          choices: null,
          runId: null,
          requestedAt: 1,
          resolved: true,
          answer: 'once',
        }}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByText('Approval recorded')).toBeTruthy()
    expect(screen.queryByTestId('approval-command')).toBeNull()
  })
})

describe('command rendering', () => {
  it('shows the command verbatim and monospaced', () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    const block = screen.getByTestId('approval-command')
    expect(block.textContent).toBe('cp ./x /etc/systemd/system/x.service')
    expect(block.className).toContain('font-mono')
  })

  it('never truncates a long command — it stays whole and expands', () => {
    const long = `echo "${'a'.repeat(400)}" | pkexec tee /etc/sudoers.d/99-x`
    render(
      <InlineClarifyCard clarify={card({}, { command: long })} sessionKey={SESSION} />,
    )
    const block = screen.getByTestId('approval-command')
    // Every character is present regardless of the visual cap.
    expect(block.textContent).toBe(long)
    expect(block.className).not.toContain('truncate')
    expect(block.className).not.toContain('line-clamp')

    fireEvent.click(screen.getByRole('button', { name: /Expand full command/ }))
    expect(screen.getByTestId('approval-command').className).not.toContain(
      'max-h-40',
    )
  })
})

describe('choices come from the payload, never a hardcoded set', () => {
  it('smart-denied renders once + deny only', () => {
    render(
      <InlineClarifyCard
        clarify={card({ choices: ['once', 'deny'] }, { smartDenied: true })}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Allow for this session' }),
    ).toBeNull()
    expect(screen.getByText('Flagged unsafe')).toBeTruthy()
  })

  it('a tirith finding renders once + session + deny, with no permanent grant', () => {
    render(
      <InlineClarifyCard
        clarify={card(
          { choices: ['once', 'session', 'deny'] },
          { allowPermanent: false },
        )}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByRole('button', { name: 'Allow for this session' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Always allow' })).toBeNull()
  })

  it('the full variant renders all four', () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    for (const label of [
      'Allow once',
      'Allow for this session',
      'Always allow',
      'Deny',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('renders an unrecognised choice verbatim rather than dropping it', () => {
    render(
      <InlineClarifyCard
        clarify={card({ choices: ['once', 'escalate-to-ops'] })}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByRole('button', { name: 'escalate-to-ops' })).toBeTruthy()
  })
})

describe('resolution', () => {
  it('POSTs the choice to the run-keyed endpoint and records the decision', async () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/runs/run_1111/approval',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ choice: 'once' }),
        }),
      )
    })
    await waitFor(() => {
      const stored = useChatStore.getState().getPendingClarify(SESSION)
      expect(stored?.resolved).toBe(true)
      expect(stored?.answer).toBe('once')
    })
  })

  it('409 is benign: the card closes with an explanation, not an error', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        benign: true,
        reason: 'not_pending',
        error: 'Run has no pending approval: run_1111',
      }) as never,
    )
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    await waitFor(() => {
      const stored = useChatStore.getState().getPendingClarify(SESSION)
      expect(stored?.resolved).toBe(true)
      expect(stored?.closedNote).toContain('already handled')
    })
    expect(screen.queryByText(/Run has no pending approval/)).toBeNull()
  })

  it('404 is benign too — the run was swept', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { ok: false, benign: true, reason: 'run_not_found' }) as never,
    )
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => {
      expect(
        useChatStore.getState().getPendingClarify(SESSION)?.closedNote,
      ).toBeTruthy()
    })
  })

  it('500 is real: the error shows and the card stays answerable', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(500, { ok: false, error: 'gateway exploded' }) as never,
    )
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))

    await waitFor(() => {
      expect(screen.getByText('gateway exploded')).toBeTruthy()
    })
    // The decision was NOT recorded, so the buttons must still work.
    expect(
      useChatStore.getState().getPendingClarify(SESSION)?.resolved,
    ).toBeFalsy()
    expect(
      screen.getByRole('button', { name: 'Allow once' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('400 is real too', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(400, { ok: false, error: 'Invalid approval choice' }) as never,
    )
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => {
      expect(screen.getByText('Invalid approval choice')).toBeTruthy()
    })
  })
})

describe('always is a security grant, not a fourth button', () => {
  it('does not resolve on first click — it asks, naming the real consequence', async () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)

    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }))

    expect(fetch).not.toHaveBeenCalled()
    expect(
      screen.getByText(/including commands you have not seen yet/),
    ).toBeTruthy()
    expect(screen.getByText(/~\/.hermes\/config.yaml/)).toBeTruthy()
    expect(screen.getByText(/Review or revoke under Settings → Safety/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Open Settings → Safety' }).getAttribute(
        'href',
      ),
    ).toBe('/settings')
  })

  it('sends always only after the confirmation is accepted', async () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })

    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }))
    fireEvent.click(screen.getByRole('button', { name: /Yes —/ }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/runs/run_1111/approval',
        expect.objectContaining({ body: JSON.stringify({ choice: 'always' }) }),
      )
    })
  })

  it('cancelling the confirmation sends nothing and restores the choices', () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)

    fireEvent.click(screen.getByRole('button', { name: 'Always allow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy()
  })

  it('the other three choices submit immediately, with no confirmation', async () => {
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this session' }))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/runs/run_1111/approval',
        expect.objectContaining({ body: JSON.stringify({ choice: 'session' }) }),
      )
    })
  })
})

describe('expiry', () => {
  it('counts down from expires_at rather than assuming 60s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-10T09:30:00Z'))
    render(
      <InlineClarifyCard
        clarify={card({}, { expiresAt: '2026-08-10T09:30:20Z' })}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByRole('timer').textContent).toContain('0:20')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByRole('timer').textContent).toContain('0:15')
  })

  it('self-clears on expiry and says it was auto-denied — no event ever arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-10T09:30:00Z'))
    useChatStore.setState({
      pendingClarify: {
        [SESSION]: card({}, { expiresAt: '2026-08-10T09:30:05Z' }),
      },
    })
    render(
      <InlineClarifyCard
        clarify={card({}, { expiresAt: '2026-08-10T09:30:05Z' })}
        sessionKey={SESSION}
      />,
    )

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    const stored = useChatStore.getState().getPendingClarify(SESSION)
    expect(stored?.resolved).toBe(true)
    expect(stored?.closedNote).toContain('auto-denied')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to a 3-minute countdown when the payload carries no deadline (#17)', () => {
    // Previously this bailed out with no countdown at all when `expiresAt`
    // was absent — combined with approvals being exempt from the
    // stream-error clears (use-streaming-message.ts), such a card had no
    // removal path whatsoever. It now anchors a fallback deadline
    // (`approvals.timeout`, 180s in the shipped profile configs) at the
    // moment the card renders.
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-10T09:30:00Z'))
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)
    expect(screen.getByRole('timer').textContent).toContain('3:00')

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(screen.getByRole('timer').textContent).toContain('2:55')
  })

  it('self-closes via the fallback deadline when no expires_at ever arrives', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-08-10T09:30:00Z'))
    useChatStore.setState({ pendingClarify: { [SESSION]: card() } })
    render(<InlineClarifyCard clarify={card()} sessionKey={SESSION} />)

    act(() => {
      vi.advanceTimersByTime(180_000)
    })

    const stored = useChatStore.getState().getPendingClarify(SESSION)
    expect(stored?.resolved).toBe(true)
    expect(stored?.closedNote).toContain('auto-denied')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('closed state', () => {
  it('states the auto-deny instead of pretending a decision was made', () => {
    render(
      <InlineClarifyCard
        clarify={card({ resolved: true, closedNote: 'Timed out. auto-denied' })}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByText('Approval closed')).toBeTruthy()
    expect(screen.getByText(/auto-denied/)).toBeTruthy()
  })

  it('shows the recorded decision when the user actually answered', () => {
    render(
      <InlineClarifyCard
        clarify={card({ resolved: true, answer: 'deny' })}
        sessionKey={SESSION}
      />,
    )
    expect(screen.getByText('Approval recorded')).toBeTruthy()
    expect(screen.getByText('Deny')).toBeTruthy()
  })
})
