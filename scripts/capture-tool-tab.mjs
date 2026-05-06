#!/usr/bin/env node
/**
 * Capture the tool tab view after the fix.
 * Usage: node scripts/capture-tool-tab.mjs [sessionKey]
 * Requires: pnpm dev running on :3000, playwright installed.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sessionKey = process.argv[2] ?? 'main'
const url = `http://localhost:3000/chat/${sessionKey}`
const outDir = resolve(__dirname, '../e2e/__screenshots__')
const outFile = resolve(outDir, 'tool-tab-after-fix.png')

mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setViewportSize({ width: 1600, height: 900 })

console.log(`Navigating to ${url} …`)
await page.goto(url, { waitUntil: 'networkidle' })

// Click the tool tab — try data-testid first, then text-based fallback
const toolTabSelector = '[data-testid="tab-tool"], [data-tab="tool"]'
const toolTabByText = page.getByRole('button', { name: /^tool/i })

let clicked = false
const tabEl = page.locator(toolTabSelector).first()
if (await tabEl.count() > 0) {
  await tabEl.click()
  clicked = true
} else if (await toolTabByText.count() > 0) {
  await toolTabByText.first().click()
  clicked = true
} else {
  // Try any tab/button containing "tool"
  await page.locator('button, [role="tab"]').filter({ hasText: /tool/i }).first().click()
  clicked = true
}

if (!clicked) {
  console.error('Could not find tool tab — capturing full page instead.')
}

// Wait for tool cards or the "no tool invocations" message
await page.waitForTimeout(800)

// Screenshot the chat content area (right of sidebar, exclude sidebar)
const chatContent = page.locator('[data-testid="chat-content"], .chat-content, main').first()
if (await chatContent.count() > 0) {
  await chatContent.screenshot({ path: outFile })
} else {
  await page.screenshot({ path: outFile, fullPage: false })
}

await browser.close()
console.log(`Screenshot saved: ${outFile}`)
