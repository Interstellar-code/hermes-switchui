#!/usr/bin/env node
/**
 * Captures the v2 sessions sidebar at localhost:3000/chat and saves it
 * for visual comparison against the mockup reference.
 *
 * Output: e2e/__screenshots__/sidebar-current.png
 *
 * Requires dev server running on :3000 with VITE_HERMES_SIDEBAR_V2=true.
 */

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT = join(ROOT, 'e2e/__screenshots__/sidebar-current.png')

const URL = process.env.URL || 'http://localhost:3000/chat'
const VIEWPORT = { width: 1600, height: 900 }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: VIEWPORT })
const page = await ctx.newPage()

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20_000 })
// Wait for either the v2 panel or chat shell to render
try {
  await page.waitForSelector('[data-testid="sessions-panel"], [data-testid="primary-nav-v2"]', { timeout: 8_000 })
} catch {
  console.warn('panel selector not found, capturing anyway')
}
await page.waitForTimeout(1500)

// Clip just the primary nav + sessions panel (left 600 px)
await page.screenshot({
  path: OUT,
  clip: { x: 0, y: 0, width: 600, height: VIEWPORT.height },
})

await browser.close()
console.log(`Saved ${OUT}`)
