/**
 * safety-posture.ts — Pure logic behind the Safety settings section.
 *
 * Computes the combined-state summary that section-safety.tsx renders, and
 * annotates `command_allowlist` entries with what they actually permit.
 *
 * Verified against ~/.hermes/hermes-agent (tools/approval.py, hermes_cli/config.py):
 *   - `_command_matches_permanent_allowlist()` runs BEFORE
 *     `detect_dangerous_command()` in both `check_command_approval()`-style
 *     gates (approval.py:2932-2935) and the interactive gate
 *     (approval.py:3244-3248) — an allowlist hit skips danger classification
 *     entirely, it does not merely pre-approve a classified-dangerous command.
 *   - `approvals.mode` default is "smart"; "manual" always prompts; "off" is
 *     the YOLO equivalent and bypasses every prompt (hermes_cli/config.py
 *     DEFAULT_CONFIG "approvals" block).
 *   - `security.tirith_enabled` and `security.tirith_fail_open` both default
 *     `true` (hermes_cli/config.py DEFAULT_CONFIG "security" block). Fail-open
 *     means a scanner outage is treated as "allow" (tools/approval.py
 *     ~3290-3361).
 *   - `command_allowlist` entries are either a dangerous-pattern *key* (e.g.
 *     "recursive delete", stored verbatim when a user clicks "[a]lways" on a
 *     prompt — approval.py `save_permanent_allowlist`) or raw command text /
 *     glob (matched via fnmatch — approval.py `_command_matches_permanent_allowlist`).
 *     KNOWN_DANGEROUS_PATTERNS below mirrors the pattern-key half of
 *     `DANGEROUS_PATTERNS` in tools/approval.py.
 */

export type SafetyConfig = {
  approvalsMode?: string
  approvalsCronMode?: string
  destructiveSlashConfirm?: boolean
  mcpReloadConfirm?: boolean
  hooksAutoAccept?: boolean
  tirithEnabled?: boolean
  tirithFailOpen?: boolean
  commandAllowlist?: Array<string>
}

export type PostureTone = 'critical' | 'warning' | 'ok'

export type SafetyPosture = {
  tone: PostureTone
  /** The one-sentence combined-state summary. */
  headline: string
  /** Supporting bullet points (tirith posture, cron mode, etc). */
  notes: Array<string>
}

/**
 * Dangerous-pattern keys a "[a]lways approve" click can permanently allowlist,
 * mirroring the description half of `DANGEROUS_PATTERNS` in
 * hermes-agent/tools/approval.py. Not exhaustive (the source list has ~60
 * entries) — covers the patterns most likely to appear in a real allowlist
 * and everything the audit's example 16-entry config carried.
 */
export const KNOWN_DANGEROUS_PATTERNS: Record<string, string> = {
  'delete in root path': 'Deletes files rooted at /',
  'recursive delete': 'Recursively deletes a directory tree (rm -rf and equivalents)',
  'recursive delete (long flag)': 'Recursively deletes a directory tree (--recursive)',
  'format filesystem': 'Formats a filesystem (mkfs)',
  'disk copy': 'Raw disk copy — can overwrite a whole device (dd if=)',
  'write to block device': 'Writes directly to a block device (/dev/sd*)',
  'SQL DROP': 'Drops a SQL table or database',
  'SQL DELETE without WHERE': 'Deletes every row in a SQL table (no WHERE clause)',
  'SQL TRUNCATE': 'Empties a SQL table (TRUNCATE)',
  'overwrite system config': 'Overwrites a system config file',
  'stop/restart system service': 'Stops, restarts, disables, or masks a system service',
  'kill all processes': 'Kills every process on the machine (kill -9 -1)',
  'force kill processes': 'Force-kills processes by pattern (pkill -9)',
  'force kill processes (killall -KILL)': 'Force-kills processes by name (killall -9/-KILL)',
  'force kill processes (killall -s KILL)': 'Force-kills processes by name (killall -s KILL)',
  'fork bomb': 'Fork bomb — exhausts process table / crashes the machine',
  'pipe remote content to shell': 'Pipes downloaded content straight into a shell',
  'overwrite system file via tee': 'Overwrites a sensitive file via tee',
  'overwrite system file via redirection': 'Overwrites a sensitive file via shell redirection (>)',
  'xargs with rm': 'Deletes a batch of files via xargs + rm',
  'find -exec/-execdir rm': 'Deletes files found by `find -exec rm`',
  'find -delete': 'Deletes files found by `find -delete`',
  'stop/restart hermes gateway (kills running agents)':
    'Stops or restarts the Hermes gateway, killing every running agent',
  'hermes update (restarts gateway, kills running agents)':
    'Runs `hermes update`, which restarts the gateway and kills running agents',
  'docker compose restart/stop/kill/down (container lifecycle)':
    'Restarts, stops, or tears down docker-compose containers',
  'docker restart/stop/kill (container lifecycle)': 'Restarts, stops, or kills a docker container',
  'kill hermes/gateway process (self-termination)': 'Kills the Hermes/gateway process directly',
  'stop/restart hermes launchd service (kills running agents)':
    'Stops or restarts the Hermes launchd service (macOS), killing running agents',
  'git reset --hard (destroys uncommitted changes)': 'git reset --hard — destroys uncommitted changes',
  'git force push (rewrites remote history)': 'git push --force — rewrites remote history',
  'git force push short flag (rewrites remote history)': 'git push -f — rewrites remote history',
  'git clean with force (deletes untracked files)': 'git clean -f — deletes untracked files',
  'git branch force delete': 'git branch -D — force-deletes a branch, even unmerged',
  'git branch force delete (long flags)': 'git branch --delete --force — force-deletes a branch',
  'sudo with privilege flag (stdin/askpass/shell/list)':
    'sudo with a non-interactive privilege flag (-S/-A/-s/-a)',
  'sudo with combined-flag privilege escalation': 'sudo with a packed privilege-escalation flag',
  'world/other-writable permissions': 'chmod 777 / o+w — makes a file world-writable',
  'recursive chown to root': 'Recursively changes ownership to root',
}

export type AllowlistEntryInfo = {
  raw: string
  /** Human description of what this entry actually permits. */
  description: string
  /** Whether this entry matched a known named dangerous-pattern key. */
  known: boolean
}

/** Annotate a single `command_allowlist` entry with what it actually permits. */
export function describeAllowlistEntry(raw: string): AllowlistEntryInfo {
  const known = KNOWN_DANGEROUS_PATTERNS[raw]
  if (known) {
    return { raw, description: known, known: true }
  }
  const isGlob = /[*?[\]]/.test(raw)
  return {
    raw,
    description: isGlob
      ? `Matches any command like \`${raw}\` — never re-checked for danger`
      : `Bypasses approval whenever the command is exactly \`${raw}\``,
    known: false,
  }
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Compute the combined-state posture summary. This is the one sentence a
 * user who has never heard of `command_allowlist` should be able to read and
 * immediately understand why the current configuration is, or isn't, risky.
 */
export function computeSafetyPosture(config: SafetyConfig): SafetyPosture {
  const mode = (config.approvalsMode ?? 'smart').toLowerCase()
  const allowlist = config.commandAllowlist ?? []
  const tirithEnabled = config.tirithEnabled ?? true
  const tirithFailOpen = config.tirithFailOpen ?? true

  const entries = allowlist.map(describeAllowlistEntry)
  const knownDangerous = entries.filter((e) => e.known)

  const notes: Array<string> = []
  if (!tirithEnabled) {
    notes.push(
      'No pre-execution security scanner is active — dangerous commands rely solely on approval prompts and the allowlist below.',
    )
  } else if (tirithFailOpen) {
    notes.push(
      'The Tirith security scanner is on, but set to fail open: if the scanner errors or is unreachable, commands are allowed through rather than blocked.',
    )
  } else {
    notes.push(
      'The Tirith security scanner is on and set to fail closed: a scanner outage blocks risky commands instead of silently allowing them.',
    )
  }

  if ((config.approvalsCronMode ?? 'deny').toLowerCase() === 'approve') {
    notes.push('Cron jobs auto-approve dangerous commands with no one present to review them.')
  }

  if (mode === 'off') {
    return {
      tone: 'critical',
      headline:
        'Auto-approve is on — every command runs without a prompt, including destructive ones.',
      notes,
    }
  }

  const modeLabel = mode === 'manual' ? 'Manual approval' : 'Smart approval'

  if (allowlist.length === 0) {
    let tone: PostureTone = 'ok'
    if (!tirithEnabled || tirithFailOpen) tone = 'warning'
    const tail =
      mode === 'manual'
        ? 'every command needs your sign-off, and nothing bypasses it'
        : 'an auxiliary model screens every command, and nothing bypasses it'
    return {
      tone,
      headline: `${modeLabel} — ${tail}.`,
      notes,
    }
  }

  const examples = (knownDangerous.length > 0 ? knownDangerous : entries)
    .slice(0, 2)
    .map((e) => (e.known ? e.raw : `\`${e.raw}\``))

  const tone: PostureTone = knownDangerous.length > 0 ? 'critical' : 'warning'

  return {
    tone,
    headline:
      `${modeLabel}, but ${pluralize(allowlist.length, 'command')} bypass` +
      `${allowlist.length === 1 ? 'es' : ''} it entirely` +
      (examples.length > 0 ? ` — including ${examples.join(' and ')}` : '') +
      '.',
    notes,
  }
}

/** Remove one entry from a `command_allowlist` array (revoke). Pure, for testability. */
export function revokeAllowlistEntry(list: Array<string>, entry: string): Array<string> {
  return list.filter((e) => e !== entry)
}
