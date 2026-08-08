import { describe, expect, it } from 'vitest'
import { getRootSurfaceState } from './-root-layout-state'

describe('root layout surface state', () => {
  it('shows fullscreen onboarding until onboarding is complete', () => {
    expect(getRootSurfaceState(false)).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })

    expect(getRootSurfaceState(null)).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })

  it('shows workspace shell and post-onboarding overlays after completion', () => {
    expect(getRootSurfaceState(true)).toEqual({
      showLogin: false,
      showOnboarding: false,
      showWorkspaceShell: true,
      showPostOnboardingOverlays: true,
    })
  })

  it('shows login when auth is required and not authenticated, regardless of onboarding state', () => {
    const unauthed = { authRequired: true, authenticated: false }
    const expected = {
      showLogin: true,
      showOnboarding: false,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    }

    expect(getRootSurfaceState(false, unauthed)).toEqual(expected)
    expect(getRootSurfaceState(null, unauthed)).toEqual(expected)
    expect(getRootSurfaceState(true, unauthed)).toEqual(expected)
  })

  it('does not gate on auth when auth is not required', () => {
    expect(
      getRootSurfaceState(true, { authRequired: false, authenticated: false }),
    ).toEqual({
      showLogin: false,
      showOnboarding: false,
      showWorkspaceShell: true,
      showPostOnboardingOverlays: true,
    })
  })

  it('does not gate on auth when authenticated', () => {
    expect(
      getRootSurfaceState(false, { authRequired: true, authenticated: true }),
    ).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })
})

describe('OnboardingGate', () => {
  it('keeps the wizard up and the shell down while the user is engaged', () => {
    expect(
      getRootSurfaceState({
        complete: false,
        dismissed: false,
        active: true,
      }),
    ).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })

  it('keeps the wizard up when an engaged gate is also marked complete', () => {
    // A cross-tab completion (or a late probe) must not unmount a wizard the
    // user is standing in.
    expect(
      getRootSurfaceState({ complete: true, dismissed: false, active: true }),
    ).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })

  it('opens the workspace on dismissal but withholds post-onboarding overlays', () => {
    expect(
      getRootSurfaceState({ complete: false, dismissed: true, active: false }),
    ).toEqual({
      showLogin: false,
      showOnboarding: false,
      showWorkspaceShell: true,
      showPostOnboardingOverlays: false,
    })
  })

  it('opens the workspace and the post-onboarding overlays on completion', () => {
    expect(
      getRootSurfaceState({ complete: true, dismissed: false, active: false }),
    ).toEqual({
      showLogin: false,
      showOnboarding: false,
      showWorkspaceShell: true,
      showPostOnboardingOverlays: true,
    })
  })

  it('shows onboarding for a fresh gate', () => {
    expect(
      getRootSurfaceState({ complete: false, dismissed: false, active: false }),
    ).toEqual({
      showLogin: false,
      showOnboarding: true,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })

  it('still shows login ahead of an engaged gate', () => {
    expect(
      getRootSurfaceState(
        { complete: false, dismissed: false, active: true },
        { authRequired: true, authenticated: false },
      ),
    ).toEqual({
      showLogin: true,
      showOnboarding: false,
      showWorkspaceShell: false,
      showPostOnboardingOverlays: false,
    })
  })
})
