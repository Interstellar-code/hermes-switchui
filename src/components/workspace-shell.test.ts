import { describe, expect, it } from 'vitest'
import { MOBILE_HAMBURGER_NAV_ITEMS } from './mobile-hamburger-menu'
import { MOBILE_NAV_TABS } from './mobile-tab-bar'
import { DESKTOP_SIDEBAR_BACKDROP_CLASS } from './workspace-shell'

describe('workspace shell sidebar backdrop', () => {
  it('only spans the desktop sidebar width, not the full viewport', () => {
    expect(DESKTOP_SIDEBAR_BACKDROP_CLASS).toContain('w-[300px]')
    expect(DESKTOP_SIDEBAR_BACKDROP_CLASS).not.toContain('inset-0')
  })
})

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
