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
import { providerInitials } from '@/screens/providers/icons'

export type ProviderPickerProps = {
  choices: Array<ProviderChoice>
  selectedId: string | null
  onSelect: (id: string) => void
}

const GROUP_ORDER: ReadonlyArray<{
  id: ProviderChoiceGroup
  label: string
}> = [
  { id: 'detected', label: 'Detected locally' },
  { id: 'free', label: 'Free / no key needed' },
  { id: 'popular', label: 'Popular' },
  { id: 'all', label: 'All providers' },
]

function badgesFor(choice: ProviderChoice): ReactNode {
  const badges: Array<ReactNode> = []
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
}: ProviderPickerProps) {
  return (
    <div className="ob-prov-groups">
      {GROUP_ORDER.map(({ id, label }) => {
        const groupChoices = choices.filter((choice) => choice.group === id)
        if (groupChoices.length === 0) return null

        return (
          <div className="ob-prov-group" key={id}>
            <p className="ob-prov-group-label">{label}</p>
            <div className="ob-prov-grid">
              {groupChoices.map((choice) => (
                <div className="ob-prov" key={choice.id}>
                  {choice.hasLogo ? (
                    <span className="ob-prov-logo">
                      <ProviderLogo provider={choice.id} size={32} />
                    </span>
                  ) : (
                    <span className="ob-prov-fallback">
                      {providerInitials(choice.name)}
                    </span>
                  )}
                  <WizardPick
                    selected={choice.id === selectedId}
                    onSelect={() => onSelect(choice.id)}
                    title={choice.name}
                    subtitle={choice.detail ?? choice.description}
                    tag={badgesFor(choice)}
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
