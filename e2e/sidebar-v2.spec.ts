import { expect, test } from '@playwright/test'

/**
 * Phase 3b — Sidebar v2 visual + interaction tests.
 *
 * Prerequisites: dev server running on http://localhost:3000
 *   - Flag ON: VITE_HERMES_SIDEBAR_V2=true pnpm dev
 *
 * Run: pnpm e2e
 * Note: DO NOT run during CI without a dev server. Tests marked with skip
 *       when the flag env var is absent.
 */

test.describe('sidebar-v2 feature flag OFF (default)', () => {
  test('existing sidebar renders when flag is off', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="sidebar-shell-v2"]')).toHaveCount(0)
  })
})

test.describe('sidebar-v2 feature flag ON', () => {
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

    const header = page.locator('[data-testid="sessions-panel-header"]')
    await expect(header).toContainText('SESSIONS')
  })

  test('sessions panel is approximately 320px wide', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    if (!box) throw new Error('sessions panel has no bounding box')
    expect(box.width).toBeGreaterThanOrEqual(316)
    expect(box.width).toBeLessThanOrEqual(324)
  })

  // ── Visual diff vs mockup reference ──────────────────────────────────────

  test('visual diff — sessions panel vs mockup reference', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()

    // Wait for list to stabilize
    await page.waitForTimeout(500)

    await expect(panel).toHaveScreenshot('sidebar-v2.png', {
      maxDiffPixelRatio: 0.18,
    })
  })

  // ── Chip interaction tests ────────────────────────────────────────────────

  test('CHAT chip click toggles source in store', async ({ page }) => {
    await page.goto('/')
    const chatChip = page.locator('[data-testid="chip-chat"]')
    await expect(chatChip).toBeVisible()

    // Should not be pressed initially (all = empty)
    await expect(chatChip).toHaveAttribute('aria-pressed', 'false')

    // Click to activate
    await chatChip.click()
    await expect(chatChip).toHaveAttribute('aria-pressed', 'true')

    // Click again to deactivate
    await chatChip.click()
    await expect(chatChip).toHaveAttribute('aria-pressed', 'false')
  })

  test('ALL chip clears active source selection', async ({ page }) => {
    await page.goto('/')
    const chatChip = page.locator('[data-testid="chip-chat"]')
    const allChip = page.locator('[data-testid="sessions-panel"] button').filter({ hasText: 'ALL' })

    // Activate a source chip
    await chatChip.click()
    await expect(chatChip).toHaveAttribute('aria-pressed', 'true')

    // Click ALL chip to reset
    await allChip.click()
    await expect(chatChip).toHaveAttribute('aria-pressed', 'false')

    // Verify filter store sources[] is cleared in localStorage
    const stored = await page.evaluate(() =>
      localStorage.getItem('hermes.sessions.filter'),
    )
    if (stored) {
      const parsed = JSON.parse(stored) as { sources?: string[] }
      expect(parsed.sources ?? []).toHaveLength(0)
    }
  })

  // ── Search input test ─────────────────────────────────────────────────────

  test('search input updates and shows clear button', async ({ page }) => {
    await page.goto('/')
    const input = page.locator('[data-testid="sessions-search-input"]')
    await expect(input).toBeVisible()

    await input.fill('hello')
    await expect(input).toHaveValue('hello')

    // Clear button should appear
    const clearBtn = page.locator('[aria-label="Clear search"]')
    await expect(clearBtn).toBeVisible()

    await clearBtn.click()
    await expect(input).toHaveValue('')
  })

  // ── Card rail color test ──────────────────────────────────────────────────

  test('session cards render with rail element matching source', async ({ page }) => {
    await page.goto('/')
    const list = page.locator('[data-testid="sessions-list-v2"]')
    await expect(list).toBeVisible()

    // Check that any chat card has the chat rail data attribute
    const chatRails = page.locator('[data-testid^="card-rail-chat"]')
    const count = await chatRails.count()
    // If there are chat sessions, they should have rails
    if (count > 0) {
      await expect(chatRails.first()).toBeVisible()
    }
  })

  // ── Collapse test ─────────────────────────────────────────────────────────

  test('collapse button hides sessions panel and shows rail', async ({ page }) => {
    await page.goto('/')
    const panel = page.locator('[data-testid="sessions-panel"]')
    await expect(panel).toBeVisible()

    await page.locator('[aria-label="Collapse sessions panel"]').first().click()
    await expect(panel).not.toBeVisible()

    const rail = page.locator('[data-testid="sidebar-rail-v2"]')
    await expect(rail).toBeVisible()
    await expect(rail).toContainText('SESSIONS')
  })
})
