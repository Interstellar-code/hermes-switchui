// @vitest-environment jsdom
/**
 * The "Copy command" control on the CLI-token branch schedules a 1.8s reset.
 * Leaving the step inside that window used to schedule a setState against a
 * component that no longer existed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ONBOARDING_DRAFT_VERSION } from '../lib/onboarding-storage'
import { ConnectStep } from './connect-step'
import type {
  OnboardingDraft,
  OnboardingTransient,
} from '../lib/onboarding-storage'
import type { ProviderChoice } from '../lib/provider-choices'

vi.mock('@/screens/providers/hooks/use-nous-oauth', () => ({
  useNousOAuth: () => ({
    stage: 'idle',
    error: null,
    userCode: '',
    verificationUrl: '',
    start: vi.fn(),
    reset: vi.fn(),
  }),
  OAUTH_SUPPORTED_PROVIDERS: ['nous'],
  isOAuthSupported: (id: string) => id === 'nous',
}))

vi.mock('../hooks/use-onboarding-models', () => ({
  useOnboardingModels: () => ({
    models: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const CHOICE: ProviderChoice = {
  id: 'openai-codex',
  name: 'OpenAI Codex',
  description: 'CLI-authenticated.',
  group: 'all',
  authKind: 'cli-token',
  envKey: null,
  baseUrl: null,
  docsUrl: null,
  supportsOAuth: false,
  cliCommand: 'claude auth login openai-codex',
  detail: null,
  hasLogo: false,
}

const DRAFT: OnboardingDraft & OnboardingTransient = {
  version: ONBOARDING_DRAFT_VERSION,
  branch: 'quick',
  stepId: 'connect',
  providerId: 'openai-codex',
  baseUrl: '',
  envKey: '',
  defaultModel: '',
  makeActive: true,
  themeId: null,
  skipped: [],
  completed: [],
  savedAt: 0,
}

describe('ConnectStep', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('clears the "Copied" timer when the step unmounts', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    })
    const clearSpy = vi.spyOn(window, 'clearTimeout')

    const view = render(
      <ConnectStep
        choice={CHOICE}
        draft={DRAFT}
        onChange={vi.fn()}
        errors={[]}
        hasStoredKey={false}
        systemCheckWarning={null}
        canWrite
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    await screen.findByRole('button', { name: 'Copied' })

    clearSpy.mockClear()
    view.unmount()

    expect(clearSpy).toHaveBeenCalled()
  })
})

/**
 * The OAuth device flow is not a draft edit — approving it writes tokens into
 * the gateway's auth store immediately. A locked relaunch promises the
 * existing setup is read-only, so the flow must not be startable from there.
 */
describe('ConnectStep — OAuth under a locked relaunch', () => {
  const OAUTH_CHOICE: ProviderChoice = {
    ...CHOICE,
    id: 'nous',
    name: 'Nous Portal',
    authKind: 'oauth',
    supportsOAuth: true,
    cliCommand: null,
  }

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  function renderWith(canWrite: boolean) {
    return render(
      <ConnectStep
        choice={OAUTH_CHOICE}
        draft={{ ...DRAFT, providerId: 'nous' }}
        onChange={vi.fn()}
        errors={[]}
        hasStoredKey={false}
        systemCheckWarning={null}
        canWrite={canWrite}
      />,
    )
  }

  it('offers the sign-in button when writes are permitted', () => {
    renderWith(true)
    expect(
      screen.getByRole('button', { name: /Connect with Nous Portal/ }),
    ).toBeTruthy()
  })

  it('withholds the sign-in button when writes are locked', () => {
    renderWith(false)
    expect(screen.queryByRole('button', { name: /Connect with/ })).toBeNull()
  })

  it('explains why sign-in is unavailable rather than failing silently', () => {
    renderWith(false)
    expect(screen.getByText(/Change setup/)).toBeTruthy()
  })
})
