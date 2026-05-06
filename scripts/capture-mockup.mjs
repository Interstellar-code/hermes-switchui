/**
 * capture-mockup.mjs — render the Chat with Sessions Sidebar mockup HTML
 * at 1600×900 and save a reference PNG.
 *
 * Usage: node scripts/capture-mockup.mjs
 *
 * Requires: @playwright/test installed (pnpm add -D @playwright/test if missing)
 *           npx playwright install chromium (once)
 */

import { chromium } from '@playwright/test'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const MOCKUP_PATH = resolve(
  ROOT,
  'docs/plans/Hermes-Switchui-Design-Mockups/Chat with Sessions Sidebar.html',
)
const OUT_DIR = resolve(ROOT, 'e2e/__screenshots__')
const OUT_FILE = resolve(OUT_DIR, 'mockup-reference.png')

mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1600, height: 900 })
await page.goto(`file://${MOCKUP_PATH}`)
// Allow fonts / animations to settle
await page.waitForTimeout(800)
await page.screenshot({ path: OUT_FILE, fullPage: false })
await browser.close()

console.log(`Mockup screenshot saved: ${OUT_FILE}`)
