/**
 * QA2 LOW (FIX7 item 11) — light-theme contrast gates, computed from the
 * actual token values in styles.css: amber text, green chip text and
 * white-on-green/accent all ≥ 4.5:1 on every surface of the theme.
 *
 * On e658e043: official-light warning #9c6b2f = 4.13–4.43, success
 * #4f7c64 = 4.28–4.59 (white-on 4.77), matrix-light green #008f2d
 * white-on = 4.23 — all under the bar.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')

const LIGHT_THEMES = [
  'matrix-light',
  'claude-official-light',
  'claude-classic-light',
  'claude-slate-light',
  'claude-nous-light',
] as const

function tokens(theme: string): Record<string, string> {
  const m = css.match(
    new RegExp(`\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`),
  )
  if (!m) throw new Error(`theme block not found: ${theme}`)
  const out: Record<string, string> = {}
  for (const [, k, v] of m[1].matchAll(/(--theme-[a-z0-9-]+):\s*([^;]+);/g))
    out[k] = v.trim()
  return out
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function ratio(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

describe.each(LIGHT_THEMES)('%s — QA2 contrast tokens', (theme) => {
  const t = tokens(theme)
  const surfaces = [
    t['--theme-bg'],
    t['--theme-sidebar'],
    t['--theme-card'],
    t['--theme-card2'],
  ].filter((v): v is string => Boolean(v) && v.startsWith('#'))

  it('warning text ≥ 4.5:1 on every surface', () => {
    for (const s of surfaces)
      expect(ratio(t['--theme-warning'], s)).toBeGreaterThanOrEqual(4.5)
  })

  it('success (green chip) text ≥ 4.5:1 on every surface', () => {
    for (const s of surfaces)
      expect(ratio(t['--theme-success'], s)).toBeGreaterThanOrEqual(4.5)
  })

  it('white on success/accent (filled buttons, chips) ≥ 4.5:1', () => {
    expect(ratio('#ffffff', t['--theme-success'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#ffffff', t['--theme-accent'])).toBeGreaterThanOrEqual(4.5)
  })
})
