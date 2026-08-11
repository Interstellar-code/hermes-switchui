// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SkillsScreen } from './skills-screen'

const mockUseResolvedProfile = vi.fn<() => string | null>(() => null)
vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => mockUseResolvedProfile(),
}))

function skillsResponse(activeProfile: string) {
  return {
    skills: [],
    total: 0,
    page: 1,
    categories: [],
    profiles: [
      {
        name: 'neo',
        label: 'Neo',
        active: activeProfile === 'neo',
        tier: null,
        skillCount: 3,
        localSkillCount: 0,
      },
      {
        name: 'trinity',
        label: 'Trinity',
        active: activeProfile === 'trinity',
        tier: null,
        skillCount: 5,
        localSkillCount: 0,
      },
    ],
    // The gateway's reported active runtime profile — a third, server-side
    // notion, distinct from the sidebar's resolved profile.
    activeProfile,
    selectedProfile: activeProfile,
    allProfilesTotal: 8,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(SkillsScreen),
    ),
  )
}

/** Latest `?profile=` sent to /api/skills across all fetch calls so far. */
function lastRequestedProfile(mockFetch: ReturnType<typeof vi.fn>): string | null {
  const skillsCalls = mockFetch.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/skills?'))
  const last = skillsCalls.at(-1)
  if (!last) return null
  return new URL(last, 'http://localhost').searchParams.get('profile')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SkillsScreen profile filter', () => {
  it('follows the resolved (sidebar) profile — not the server-reported active runtime profile — when both are present', async () => {
    mockUseResolvedProfile.mockReturnValue('trinity')
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse(skillsResponse('neo'))))
    vi.stubGlobal('fetch', mockFetch)

    renderScreen()

    await waitFor(() => {
      expect(lastRequestedProfile(mockFetch)).toBe('trinity')
    })
  })

  it('falls back to the gateway-reported active profile when the sidebar has no resolved profile', async () => {
    mockUseResolvedProfile.mockReturnValue(null)
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse(skillsResponse('neo'))))
    vi.stubGlobal('fetch', mockFetch)

    renderScreen()

    await waitFor(() => {
      expect(lastRequestedProfile(mockFetch)).toBe('neo')
    })
  })

  it('keeps a deliberate local profile-filter pick until the resolver itself changes', async () => {
    mockUseResolvedProfile.mockReturnValue('neo')
    const mockFetch = vi.fn(() => Promise.resolve(jsonResponse(skillsResponse('neo'))))
    vi.stubGlobal('fetch', mockFetch)

    renderScreen()

    await waitFor(() => {
      expect(lastRequestedProfile(mockFetch)).toBe('neo')
    })

    // Deliberate "browse another profile" pick inside the skills screen.
    const trinityButton = await screen.findByRole('button', { name: /trinity/i })
    fireEvent.click(trinityButton)

    await waitFor(() => {
      expect(lastRequestedProfile(mockFetch)).toBe('trinity')
    })

    // A re-render triggered by something unrelated (search text, still under
    // the same resolved profile) must not clobber the override.
    mockFetch.mockClear()
    fireEvent.change(screen.getByPlaceholderText('Search skills…'), {
      target: { value: 'git' },
    })
    await waitFor(() => {
      expect(lastRequestedProfile(mockFetch)).toBe('trinity')
    })
  })
})
