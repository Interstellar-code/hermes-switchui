/**
 * extras.ts — everything that is genuinely optional, and the one line each
 * that says why anyone should care.
 *
 * These used to be steps: profiles, memory, plugins and a theme picker, all
 * offered before a single completion had succeeded. They are cards now, they
 * come after the gate, and each carries a reason rather than a label — the old
 * flow asked a first-time user to "choose an agent profile" with no statement
 * of what a profile is for, which is how a wizard produces a decision nobody
 * understands.
 *
 * `state` is not decoration either: a card that says "already set to X" is a
 * card the user can skip in one glance, and `suppressedBy` is how the gateway's
 * own onboarding (see `gateway-onboarding.ts`) removes a prompt it has already
 * made in conversation.
 */
import { DOCS } from './docs-links'
import { shouldOfferProfileBuild } from './gateway-onboarding'
import type { GatewayOnboardingState } from './gateway-onboarding'
import type { OnboardingStepId } from './onboarding-steps'

export type ExtraId =
  | 'profile'
  | 'memory'
  | 'plugins'
  | 'skills'
  | 'mcp'
  | 'theme'

export type ExtraCard = {
  id: ExtraId
  label: string
  /** One line. Why this is worth a minute — not what it is. */
  reason: string
  /** What is true right now, or null when nothing is configured. */
  state: string | null
  /** A step inside this wizard, when there is one. */
  goTo: OnboardingStepId | null
  /** A workspace route, for the things this wizard does not own. */
  href: string | null
  docs: string
  /**
   * Set when the card is deliberately not offered, naming why. Rendered as a
   * quiet line rather than hidden outright: silently dropping a card a user
   * expected to see is its own confusion.
   */
  suppressedBy?: string
}

export type BuildExtrasInput = {
  gateway: GatewayOnboardingState
  activeProfileName: string | null
  activeMemoryProvider: string | null
  enabledPluginCount: number
  corePluginCount: number
  themeLabel: string | null
}

export function buildExtras(input: BuildExtrasInput): Array<ExtraCard> {
  const offerProfileBuild = shouldOfferProfileBuild(input.gateway)

  const cards: Array<ExtraCard> = [
    {
      id: 'profile',
      label: 'Agent profiles',
      reason:
        'A second profile gives you a separate agent — its own config, memory and sessions — without touching this one.',
      state: input.activeProfileName
        ? `Running “${input.activeProfileName}”.`
        : null,
      goTo: 'profile',
      href: '/profiles',
      docs: DOCS.profiles,
    },
    {
      id: 'memory',
      label: 'Memory',
      reason:
        'Without a memory provider the agent starts every session knowing nothing about you or your work.',
      state: input.activeMemoryProvider
        ? `Using ${input.activeMemoryProvider}.`
        : 'Built-in MEMORY.md only.',
      goTo: 'memory',
      href: '/memory',
      docs: DOCS.memory,
      // The gateway offers to build a user profile into memory on the very
      // first message. Pitching the same thing here is the double prompt this
      // rebuild set out to remove.
      suppressedBy: offerProfileBuild
        ? undefined
        : input.gateway.profileBuild === 'off'
          ? 'You have turned the agent’s own profile-building offer off (onboarding.profile_build: off).'
          : 'The agent has already offered to build your profile in conversation.',
    },
    {
      id: 'plugins',
      label: 'Core plugins',
      reason:
        'A few workspace screens stay empty until the plugin behind them is enabled on the gateway.',
      state:
        input.corePluginCount > 0
          ? `${input.enabledPluginCount} of ${input.corePluginCount} enabled.`
          : null,
      goTo: 'plugins',
      href: '/plugins',
      docs: DOCS.gateway,
    },
    {
      id: 'mcp',
      label: 'MCP servers',
      reason:
        'MCP is how the agent reaches tools that are not built in — your issue tracker, your database, your browser.',
      state: null,
      goTo: null,
      href: '/mcp',
      docs: DOCS.mcp,
    },
    {
      id: 'skills',
      label: 'Skills',
      reason:
        'A skill is a reusable procedure the agent loads on demand, so you stop re-explaining the same task.',
      state: null,
      goTo: null,
      href: '/skills',
      docs: DOCS.skills,
    },
    {
      id: 'theme',
      label: 'Theme',
      reason:
        'Five palettes, dark and light. Costs nothing and takes ten seconds.',
      state: input.themeLabel,
      goTo: 'theme',
      href: '/settings',
      docs: DOCS.quickstart,
    },
  ]

  return cards
}
