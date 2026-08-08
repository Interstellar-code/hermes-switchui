import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const LIGHT_THEMES = new Set([
  'claude-nous-light',
  'claude-official-light',
  'claude-classic-light',
  'claude-slate-light',
])

function useIsLightTheme(): boolean {
  const [light, setLight] = useState(false)
  useEffect(() => {
    const check = () => {
      const theme = document.documentElement.getAttribute('data-theme') || ''
      setLight(LIGHT_THEMES.has(theme))
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])
  return light
}

/** Provider ids that ship a logo asset, mapped to their file name. */
const PROVIDER_LOGO_FILES: Record<string, string> = {
  nous: 'nous.png',
  'openai-codex': 'openai.png',
  openai: 'openai.png',
  anthropic: 'anthropic.png',
  openrouter: 'openrouter.png',
  ollama: 'ollama.png',
  'atomic-chat': 'atomic-chat.png',
  kimi: 'kimi.png',
  'kimi-coding': 'kimi.png',
  minimax: 'minimax.png',
  zai: 'zhipu.png',
  zhipu: 'zhipu.png',
}

/**
 * Whether a real logo exists for this provider. Callers that render their own
 * themed fallback should check this rather than accept the grey placeholder.
 */
export function hasProviderLogo(provider: string): boolean {
  return provider in PROVIDER_LOGO_FILES
}

export function ProviderLogo({
  provider,
  size = 32,
  className,
}: {
  provider: string
  size?: number
  className?: string
}) {
  const isLight = useIsLightTheme()
  const base = isLight ? '/providers/light' : '/providers'

  const file = PROVIDER_LOGO_FILES[provider]
  if (!file) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg bg-neutral-600 text-white text-xs font-bold',
          className,
        )}
        style={{ width: size, height: size }}
      >
        {(provider || 'C')[0].toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={`${base}/${file}`}
      alt={provider}
      className={cn('rounded-lg object-cover', className)}
      style={{ width: size, height: size }}
    />
  )
}
