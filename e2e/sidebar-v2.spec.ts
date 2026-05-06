import { expect, test } from '@playwright/test'

/**
 * Phase 3a — Sidebar v2 smoke tests.
 *
 * Prerequisites: dev server running on http://localhost:3000
 *   - Flag OFF:  pnpm dev
 *   - Flag ON:   VITE_HERMES_SIDEBAR_V2=true pnpm dev
 *
 * Run: pnpm e2e
 */

test.describe('sidebar-v2 feature flag OFF (default)', () => {
  test('existing sidebar renders when flag is off', async ({ page }) => {
    await page.goto('/')
    // The existing v1 sidebar uses data-sidebar attribute or its root element.
    // Verify v2 shell is NOT present.
    await expect(page.locator('[data-testid="sidebar-shell-v2"]')).toHaveCount(0)
  })
})

test.describe('sidebar-v2 feature flag ON', () => {
  // These tests assume the dev server was started with VITE_HERMES_SIDEBAR_V2=true
  test.skip(
    process.env.VITE_HERMES_SIDEBAR_V2 !== 'true',
    'Set VITE_HERMES_SIDEBAR_V2=true and restart dev server to run v2 tests',
  )

  test('v2 shell renders with sessions panel', async ({ page }) => {
    await page.goto('/')
    const shell = page.locator('[data-testid="sidebar-shell-v2"]')
    await expect(shell).toBeVisible()

    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()

    // Sessions panel header text
    const header = page.locator('[data-testid="sessions-panel-header"]')
    await expect(header).toContainText('Sessions')
  })

  test('sessions panel is approximately 320px wide', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    if (!box) throw new Error('sessions panel has no bounding box')
    // Allow ±4px for borders
    expect(box.width).toBeGreaterThanOrEqual(316)
    expect(box.width).toBeLessThanOrEqual(324)
  })

  test('visual baseline — sessions panel region', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()
    const clip = await panel.boundingBox()
    await page.screenshot({
      path: 'e2e/__screenshots__/sidebar-v2.baseline.png',
      ...(clip ? { clip } : {}),
    })
  })
})
