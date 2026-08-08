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
})
