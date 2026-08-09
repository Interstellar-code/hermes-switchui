/**
 * gateway-onboarding.ts — read the onboarding state the *gateway* keeps, so
 * this wizard stops asking about things it has already handled.
 *
 * Hermes has its own first-touch onboarding, and it is not a wizard: it is a
 * set of one-shot contextual hints, each shown the first time a user hits the
 * behaviour fork it explains, then never again. The flags live in the same
 * `config.yaml` this workspace already fetches, under `onboarding.seen.<flag>`
 * (`agent/onboarding.py`), and the flag names are a stable contract — the
 * module's own docstring says so, and `mark_seen` writes them verbatim.
 *
 *   busy_input_prompt        first message sent while the agent was busy → /busy
 *   tool_progress_prompt     first long-running tool → /verbose
 *   openclaw_residue_cleanup a legacy ~/.openclaw was found → hermes claw migrate
 *   profile_build_offered    the agent has already offered, in conversation, to
 *                            build a user profile into memory
 *
 * `onboarding.profile_build` is a *mode*, not a seen-flag: `"ask"` (default)
 * means the agent will make that offer on the very first message ever, `"off"`
 * means it never will. Both matter here. If the agent is going to offer, this
 * wizard pitching the same thing as a card is a double prompt; if the user has
 * turned it off, pitching it is worse than a double prompt.
 *
 * Everything is read tolerantly. A gateway too old to have written the block,
 * a masked payload, a `null` config — all of them mean "nothing seen", which
 * is the behaviour we had before this module existed.
 */

export const GATEWAY_ONBOARDING_FLAGS = [
  'busy_input_prompt',
  'tool_progress_prompt',
  'openclaw_residue_cleanup',
  'profile_build_offered',
] as const

export type GatewayOnboardingFlag = (typeof GATEWAY_ONBOARDING_FLAGS)[number]

export type ProfileBuildMode = 'ask' | 'off'

export type GatewayOnboardingState = {
  /** Which one-shot hints the gateway has already shown. */
  seen: Record<GatewayOnboardingFlag, boolean>
  /** `agent/onboarding.py:profile_build_mode` — anything but "off" is "ask". */
  profileBuild: ProfileBuildMode
  /** True when the config carried an `onboarding:` block at all. */
  present: boolean
}

export const EMPTY_GATEWAY_ONBOARDING: GatewayOnboardingState = {
  seen: {
    busy_input_prompt: false,
    tool_progress_prompt: false,
    openclaw_residue_cleanup: false,
    profile_build_offered: false,
  },
  profileBuild: 'ask',
  present: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Parse `config.onboarding` out of a raw `/api/claude-config` `config` payload. */
export function readGatewayOnboarding(config: unknown): GatewayOnboardingState {
  if (!isRecord(config)) return EMPTY_GATEWAY_ONBOARDING
  const block = config.onboarding
  if (!isRecord(block)) return EMPTY_GATEWAY_ONBOARDING

  const seenBlock = isRecord(block.seen) ? block.seen : {}
  const seen = { ...EMPTY_GATEWAY_ONBOARDING.seen }
  for (const flag of GATEWAY_ONBOARDING_FLAGS) {
    seen[flag] = seenBlock[flag] === true
  }

  const rawMode = block.profile_build
  const profileBuild: ProfileBuildMode =
    typeof rawMode === 'string' && rawMode.trim().toLowerCase() === 'off'
      ? 'off'
      : 'ask'

  return { seen, profileBuild, present: true }
}

/**
 * Whether this wizard should pitch "build a profile of me" as something the
 * user still has to arrange.
 *
 * No when the agent has already made the offer in conversation
 * (`profile_build_offered`), and no when the user has switched the offer off —
 * in the second case re-pitching it in a settings surface is overriding a
 * choice they already made.
 */
export function shouldOfferProfileBuild(
  state: GatewayOnboardingState,
): boolean {
  if (state.profileBuild === 'off') return false
  return !state.seen.profile_build_offered
}

export type GatewayTip = { id: GatewayOnboardingFlag; text: string }

/**
 * The hints the gateway has NOT yet shown, phrased for a setup screen.
 *
 * Deliberately inverted from how the gateway uses the same flags: it shows a
 * hint once and then stops, so an unseen flag is exactly a piece of behaviour
 * the user has not met yet — worth a line here, and pointless once they have.
 */
export function pendingGatewayTips(
  state: GatewayOnboardingState,
): Array<GatewayTip> {
  const tips: Array<GatewayTip> = []
  if (!state.seen.busy_input_prompt) {
    tips.push({
      id: 'busy_input_prompt',
      text: 'Messaging while the agent is working interrupts it by default. `/busy queue` and `/busy steer` change that.',
    })
  }
  if (!state.seen.tool_progress_prompt) {
    tips.push({
      id: 'tool_progress_prompt',
      text: 'Long tool runs stream every step. `/verbose` cycles how much of that you see.',
    })
  }
  if (!state.seen.openclaw_residue_cleanup) {
    // Only meaningful on a machine that has one, which the gateway detects and
    // we cannot — so this is phrased as a conditional rather than a finding.
    tips.push({
      id: 'openclaw_residue_cleanup',
      text: 'Coming from OpenClaw? `hermes claw migrate` ports config, memory and skills over.',
    })
  }
  return tips
}
