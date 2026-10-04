/**
 * Canvas colour resolution for Memory Map tokens.
 *
 * Tokens may be written in syntax canvas `fillStyle` can't parse
 * (`var()`, `color-mix()`, relative `oklch(from …)`), so each one is resolved
 * through a hidden probe element inside `el` (so `.mm-wrap`-scoped tokens
 * apply): `probe.style.color = var(--x)` → computed `rgb()`/`oklch()`.
 * Cached per theme (the <html> data-theme + class).
 */

const cache = new Map<string, string>()

function themeKey(): string {
  const html = document.documentElement
  return `${html.getAttribute('data-theme') ?? ''}|${html.className}`
}

export function resolveCssColor(
  el: HTMLElement,
  varName: string,
  fallback: string,
): string {
  const key = `${themeKey()}|${varName}`
  const hit = cache.get(key)
  if (hit) return hit
  const raw = getComputedStyle(el).getPropertyValue(varName).trim()
  // undeclared → the probe would just inherit `color`; use the fallback
  if (!raw) return fallback
  const probe = document.createElement('span')
  probe.style.display = 'none'
  probe.style.color = `var(${varName})`
  el.appendChild(probe)
  const resolved = getComputedStyle(probe).color.trim()
  probe.remove()
  const out = resolved && !resolved.includes('var(') ? resolved : raw
  cache.set(key, out)
  return out
}
