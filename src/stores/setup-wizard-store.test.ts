import { afterEach, describe, expect, it } from 'vitest'
import { useSetupWizardStore } from './setup-wizard-store'

function resetStore() {
  useSetupWizardStore.setState({ open: false, target: null })
}

describe('setup-wizard-store', () => {
  afterEach(() => {
    resetStore()
  })

  it('bare openSetupWizard() opens with no target', () => {
    useSetupWizardStore.getState().openSetupWizard()

    expect(useSetupWizardStore.getState().open).toBe(true)
    expect(useSetupWizardStore.getState().target).toBeNull()
  })

  it('openSetupWizard(at) sets both open and target', () => {
    useSetupWizardStore.getState().openSetupWizard('provider')

    expect(useSetupWizardStore.getState().open).toBe(true)
    expect(useSetupWizardStore.getState().target).toBe('provider')
  })

  it('closeSetupWizard clears both open and target', () => {
    useSetupWizardStore.getState().openSetupWizard('theme')
    useSetupWizardStore.getState().closeSetupWizard()

    expect(useSetupWizardStore.getState().open).toBe(false)
    expect(useSetupWizardStore.getState().target).toBeNull()
  })

  it('a later bare open does not inherit a stale deep link', () => {
    useSetupWizardStore.getState().openSetupWizard('verify')
    useSetupWizardStore.getState().closeSetupWizard()
    useSetupWizardStore.getState().openSetupWizard()

    expect(useSetupWizardStore.getState().open).toBe(true)
    expect(useSetupWizardStore.getState().target).toBeNull()
  })

  /**
   * The sidebar passed this action straight to an `onClick`, so React handed
   * it a MouseEvent as the deep-link target. The wizard could not resolve that
   * to a step and reconciled the user onto the welcome fork instead of the
   * read-only relaunch summary.
   */
  it('ignores a non-step argument such as a click event', () => {
    const clickEvent = { type: 'click', currentTarget: null, bubbles: true }
    ;(useSetupWizardStore.getState().openSetupWizard as (at?: unknown) => void)(
      clickEvent,
    )

    expect(useSetupWizardStore.getState().open).toBe(true)
    expect(useSetupWizardStore.getState().target).toBeNull()
  })

  it('ignores a string that is not a known step id', () => {
    ;(useSetupWizardStore.getState().openSetupWizard as (at?: unknown) => void)(
      'not-a-step',
    )

    expect(useSetupWizardStore.getState().target).toBeNull()
  })
})
