// @vitest-environment jsdom
/**
 * The `security.redact_secrets` row used to claim it stripped values "from log
 * output" only. The agent's redactor (agent/redact.py) masks credential-shaped
 * strings in tool/terminal output and in assistant messages as they are stored
 * to session history, snapshotted at startup. This pins the corrected copy —
 * the test fails on the old narrower description.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionPrivacy from './section-privacy'

vi.mock('@/lib/hermes-client', () => ({}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionPrivacy', () => {
  it('describes redact_secrets by what the agent actually redacts', () => {
    render(<SectionPrivacy />)

    expect(
      screen.getByText(
        /Credential-shaped strings \(API keys, tokens, passwords\) are masked in tool and terminal output and in assistant messages as they are stored to session history/,
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/Strip \*_API_KEY/)).toBeNull()
  })

  it('renders the privacy and network rows unchanged', () => {
    render(<SectionPrivacy />)

    expect(
      screen.getByRole('switch', { name: /Redact PII from context/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole('switch', { name: /Allow private \/ internal URLs/ }),
    ).toBeTruthy()
  })
})
