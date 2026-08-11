/**
 * profile-servability.ts — "can every profile on disk actually be reached?",
 * asked at setup-check time instead of at send time.
 *
 * The gap this closes: `src/server/profile-scope.ts`'s `assertProfileServed`
 * already knows the answer — it fails closed with a typed, specific refusal —
 * but it is only ever consulted at SEND time, after a message has been
 * composed. Every signal it needs is already visible far earlier:
 * `/api/profiles/list` for the on-disk roster, `/api/gateway-status`'s
 * `scope` (a direct forward of `profile-scope.ts`'s `getGatewayMode()`) for
 * the live topology. This module is the pure merge of the two, so the
 * onboarding checklist can say the same thing `profile-scope.ts` would say at
 * send time — just early enough to act on before a message is ever composed.
 *
 * Deliberately reuses `profile-scope.ts`'s topology probe rather than adding a
 * second one: `ProfileScopeSnapshot` below is shaped to be filled straight
 * from `ScopeStatusResponse` (`chat-composer-services.ts`'s
 * `fetchScopeStatus`), which already *is* `profile-scope.ts`'s `GatewayMode`,
 * forwarded verbatim by `/api/gateway-status`. `use-profile-servability.ts` is
 * the adapter, and it shares the composer's own query key so mounting it adds
 * an observer to an existing request rather than a second network round trip.
 *
 * Two "not wrong, not right" outcomes are load-bearing:
 *
 *   - A single profile on disk is a legitimate install with nothing else to
 *     reach. Multiplexing being off is not a defect there, so this never
 *     fires for it, regardless of topology — the exact "must not nag a
 *     healthy single-profile install" rule the task that added this exists to
 *     protect.
 *   - `mode: 'unknown'` means the topology genuinely could not be established
 *     (a gated/remote dashboard, a failed probe, or several independent
 *     gateways that couldn't be matched — see `profile-scope.ts`'s
 *     `GatewayMode`). Reporting that as "you are misconfigured" would be a
 *     fabricated diagnosis — precisely what `profile-scope.ts`'s own header
 *     warns against (its audit item 3, about a remote/gated client). So this
 *     reports honest uncertainty, never a verdict.
 *
 * Prefers the `served_profiles` comparison over the coarser `mode ===
 * 'multiplex'` check whenever the roster is available:
 * `gateway.multiplex_profiles: true` is necessary but not sufficient. A
 * secondary profile that enables a port-binding platform (`a2a_fleet`,
 * `feishu`, `api_server`, `webhook`, …) whose port is already taken is
 * SKIPPED at gateway startup with `SecondaryPortBindingConfigError` and never
 * appears in `served_profiles` — the gateway starts fine and that profile is
 * silently absent. Trusting `mode` alone would miss exactly that case, so
 * this always diffs the disk roster against `served_profiles` under
 * multiplex rather than treating "multiplex is on" as proof by itself.
 */

export type ProfileScopeMode = 'single' | 'multiplex' | 'unknown'

export type ProfileScopeReason =
  | 'probe-failed'
  | 'remote-gated'
  | 'multiple-gateways'

/** The subset of `profile-scope.ts`'s `GatewayMode` this check needs, shaped
 *  to be filled directly from `ScopeStatusResponse` — see module doc. */
export type ProfileScopeSnapshot = {
  mode: ProfileScopeMode
  /** Only meaningful for `'multiplex'`; the live, authoritative roster. */
  servedProfiles: Array<string> | null
  /** Only meaningful for `'single'` — the one profile a bare request
   *  provably reaches. */
  activeProfile: string | null
  /** Only meaningful for `'unknown'` — why the topology couldn't be read. */
  reason: ProfileScopeReason | null
}

export type ProfileServabilityResult =
  | { kind: 'ok' }
  | {
      kind: 'unreachable'
      /** Disk profiles this gateway cannot currently be asked to serve. */
      unreachable: Array<string>
      detail: string
      remediation: string
    }
  | {
      /** Topology unknown — never a misconfiguration claim, see module doc. */
      kind: 'indeterminate'
      detail: string
    }

function quoted(names: Array<string>): string {
  return names.map((name) => `"${name}"`).join(', ')
}

function reasonProse(reason: ProfileScopeReason | null): string {
  switch (reason) {
    case 'remote-gated':
      return (
        'this workspace is talking to a gated (non-loopback) Hermes dashboard, ' +
        'which withholds gateway topology detail from remote clients'
      )
    case 'multiple-gateways':
      return (
        'this host runs several independent per-profile gateways and none of ' +
        "them could be matched to the one this workspace is configured to use"
      )
    case 'probe-failed':
    default:
      return (
        'the gateway topology probe failed — the Hermes dashboard was ' +
        'unreachable, timed out, or answered with something unexpected'
      )
  }
}

/**
 * Decide whether every profile on `diskProfiles` is reachable under `scope`.
 *
 * Pure and side-effect free, so the table of cases (single vs. multiplex vs.
 * unknown; one profile vs. several; a full vs. partial served-roster) is
 * exercised directly in tests rather than through a mounted hook.
 */
export function evaluateProfileServability(
  diskProfiles: Array<string>,
  scope: ProfileScopeSnapshot,
): ProfileServabilityResult {
  const names = Array.from(
    new Set(diskProfiles.map((name) => name.trim()).filter(Boolean)),
  )

  // A single-profile install has nothing else to reach — multiplexing being
  // off is not a defect here, and warning about it would be exactly the
  // "twelve-step wizard" mistake `checklist.ts` already guards against for
  // the optional items. This check must stay silent for it no matter what
  // the topology probe says.
  if (names.length <= 1) return { kind: 'ok' }

  if (scope.mode === 'unknown') {
    return {
      kind: 'indeterminate',
      detail:
        `${names.length} agent profiles exist on disk, but whether every one ` +
        `of them is reachable could not be determined: ${reasonProse(scope.reason)}. ` +
        'This is not necessarily a problem — the gateway may already be ' +
        'multiplexed and serving all of them — it just cannot be confirmed ' +
        'from here.',
    }
  }

  if (scope.mode === 'single') {
    // `profile-scope.ts`'s `GatewayMode` never pairs `mode: 'single'` with a
    // null `activeProfile`, but this snapshot is a looser, test-friendly
    // shape — fail closed to honesty rather than guessing which disk profile
    // is the safe one if that guarantee is ever violated upstream.
    if (!scope.activeProfile) {
      return {
        kind: 'indeterminate',
        detail:
          `${names.length} agent profiles exist on disk, and this gateway is not ` +
          'multiplexed, but which profile it is actually running could not be ' +
          'determined, so reachability cannot be confirmed for any of them.',
      }
    }
    const unreachable = names.filter((name) => name !== scope.activeProfile)
    if (unreachable.length === 0) return { kind: 'ok' }
    return {
      kind: 'unreachable',
      unreachable,
      detail:
        `Only "${scope.activeProfile}" is reachable right now. This gateway is ` +
        `not multiplexed, so ${quoted(unreachable)} would be refused the moment ` +
        'you tried to send to them.',
      remediation:
        'Run `hermes config set gateway.multiplex_profiles true`, then restart ' +
        'the gateway so one process can reach every profile.',
    }
  }

  // `scope.mode === 'multiplex'` — diff the disk roster against the live
  // served-profiles list rather than trusting the mode alone (see module
  // doc: SecondaryPortBindingConfigError).
  const served = new Set(scope.servedProfiles ?? [])
  const unreachable = names.filter((name) => !served.has(name))
  if (unreachable.length === 0) return { kind: 'ok' }
  return {
    kind: 'unreachable',
    unreachable,
    detail:
      `Multiplexing is on, but ${quoted(unreachable)} ` +
      `${unreachable.length === 1 ? "isn't" : "aren't"} in the gateway's ` +
      "served-profile list. A profile that enables a port-binding platform " +
      '(a2a_fleet, feishu, api_server, webhook, …) is skipped at startup if its ' +
      'port is already taken, and never appears there even though the gateway ' +
      'starts fine.',
    remediation:
      `Check the gateway startup log for ${quoted(unreachable)}, resolve the ` +
      'port conflict on its port-binding platform, then restart the gateway.',
  }
}
