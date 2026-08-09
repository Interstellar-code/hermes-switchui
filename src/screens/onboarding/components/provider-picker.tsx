'use client'

/**
 * provider-picker.tsx — the grouped provider grid on the provider step.
 *
 * `WizardPick` owns the interactive button (and its `aria-pressed` wiring) but
 * has no `className` escape hatch, so it cannot itself carry `.ob-prov` — the
 * card's two-column (logo | content) layout. Instead each card is an
 * `.ob-prov` wrapper with the logo/monogram as its first child and the
 * `WizardPick` button as its second, which is exactly the "logo/name row
 * above the description" composition `.ob-prov`'s grid-template-columns is
 * built for, without touching wizard-primitives.tsx.
 */
import type { ReactNode } from 'react'
import type {
  ProviderChoice,
  ProviderChoiceGroup,
} from '@/screens/onboarding/lib/provider-choices'
import { WizardPick } from '@/components/wizard'
import { ProviderLogo } from '@/components/provider-logo'
import { normalizeProviderId } from '@/lib/provider-catalog'
import { providerInitials } from '@/screens/providers/icons'

export type ProviderPickerProps = {
  choices: Array<ProviderChoice>
  selectedId: string | null
  onSelect: (id: string) => void
  /** The provider this workspace is actually running on right now, if any. */
  activeProviderId: string | null
  /** Providers that already hold a credential, active one included. */
  configuredProviderIds: Array<string>
}

/** What the workspace already knows about a card, independent of selection. */
type ProviderCardState = 'active' | 'configured' | null

const GROUP_ORDER: ReadonlyArray<{
  id: ProviderChoiceGroup
  label: string
}> = [
  { id: 'detected', label: 'Detected locally' },
  { id: 'free', label: 'Free / no key needed' },
  { id: 'popular', label: 'Popular' },
  { id: 'all', label: 'All providers' },
]

function badgesFor(
  choice: ProviderChoice,
  cardState: ProviderCardState,
): ReactNode {
  const badges: Array<ReactNode> = []
  // First, and inside the button: `WizardPick` renders `tag` within the
  // control, so this text lands in the card's accessible name and the state
  // is never carried by colour alone.
  if (cardState === 'active') {
    badges.push(
      <span key="active" className="ob-badge ob-badge-active">
        Active
      </span>,
    )
  }
  if (cardState === 'configured') {
    badges.push(
      <span key="configured" className="ob-badge ob-badge-configured">
        Configured
      </span>,
    )
  }
  if (choice.supportsOAuth) {
    badges.push(
      <span key="oauth" className="ob-badge ob-badge-oauth">
        OAuth
      </span>,
    )
  }
  if (choice.authKind === 'local') {
    badges.push(
      <span key="local" className="ob-badge ob-badge-local">
        Local
      </span>,
    )
  }
  if (choice.authKind === 'cli-token') {
    badges.push(
      <span key="cli" className="ob-badge ob-badge-cli">
        CLI
      </span>,
    )
  }
  return badges.length > 0 ? <>{badges}</> : null
}

export function ProviderPicker({
  choices,
  selectedId,
  onSelect,
  activeProviderId,
  configuredProviderIds,
}: ProviderPickerProps) {
  const activeId = activeProviderId
    ? normalizeProviderId(activeProviderId)
    : null
  const configured = new Set(configuredProviderIds.map(normalizeProviderId))

  const stateOf = (choice: ProviderChoice): ProviderCardState => {
    if (activeId && choice.id === activeId) return 'active'
    return configured.has(choice.id) ? 'configured' : null
  }

  // Rank, not sort key: the catalog order inside each rank is meaningful
  // (it is the order `provider-choices.ts` curated), so ties keep it.
  const rankOf = (choice: ProviderChoice): number => {
    const state = stateOf(choice)
    if (state === 'active') return 0
    return state === 'configured' ? 1 : 2
  }

  return (
    <div className="ob-prov-groups">
      {GROUP_ORDER.map(({ id, label }) => {
        const groupChoices = choices
          .filter((choice) => choice.group === id)
          // The active provider has to be reachable without scrolling past two
          // dozen cards, so it is hoisted to the top of whichever group holds
          // it — `.map`/`.sort` on an index keeps the sort stable everywhere.
          .map((choice, index) => ({ choice, index }))
          .sort(
            (left, right) =>
              rankOf(left.choice) - rankOf(right.choice) ||
              left.index - right.index,
          )
          .map((entry) => entry.choice)
        if (groupChoices.length === 0) return null

        return (
          <div className="ob-prov-group" key={id}>
            <p className="ob-prov-group-label">{label}</p>
            <div className="ob-prov-grid">
              {/* The logo sits outside the button, so without aria-hidden a
                  screen reader reads `ProviderLogo`'s own `alt` (the raw
                  provider id) and the monogram's two letters as stray text
                  ahead of the card they decorate. */}
              {groupChoices.map((choice) => (
                <div
                  className={`ob-prov${
                    stateOf(choice) === 'active' ? ' is-active' : ''
                  }`}
                  key={choice.id}
                >
                  {choice.hasLogo ? (
                    <span className="ob-prov-logo" aria-hidden="true">
                      <ProviderLogo provider={choice.id} size={32} />
                    </span>
                  ) : (
                    <span className="ob-prov-fallback" aria-hidden="true">
                      {providerInitials(choice.name)}
                    </span>
                  )}
                  <WizardPick
                    selected={choice.id === selectedId}
                    onSelect={() => onSelect(choice.id)}
                    title={choice.name}
                    subtitle={choice.detail ?? choice.description}
                    tag={badgesFor(choice, stateOf(choice))}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
