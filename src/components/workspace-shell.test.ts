import { describe, expect, it } from 'vitest'
import { MOBILE_HAMBURGER_NAV_ITEMS } from './mobile-hamburger-menu'
import { MOBILE_NAV_TABS } from './mobile-tab-bar'

describe('swarm nav items removed', () => {
  it('has no swarm entry in the mobile hamburger menu', () => {
    const swarm = MOBILE_HAMBURGER_NAV_ITEMS.find((item) => item.id === 'swarm')
    expect(swarm).toBeUndefined()
  })

  it('has no swarm tab in the mobile tab bar', () => {
    const swarm = MOBILE_NAV_TABS.find((item) => item.id === 'swarm')
    expect(swarm).toBeUndefined()
  })
})
