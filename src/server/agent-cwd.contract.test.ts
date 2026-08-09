/**
 * Contract test: our resolver's constants vs the gateway's OWN constants.
 *
 * `agent-cwd.ts` replays a ladder that lives in Python. Every value it mirrors
 * — the sentinel set, the container backend set, the per-backend default cwds —
 * is a copy, and a copy silently rots. This test reads the real hermes-agent
 * source and asserts the copies still match, so an upstream change fails our
 * suite instead of the UI confidently telling a user the wrong directory.
 *
 * When the agent source is not on disk (CI without a checkout) the suite skips
 * rather than passing vacuously — the skip is visible in the reporter.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTAINER_BACKENDS,
  CONTAINER_DEFAULT_CWD,
  DEFAULT_EXECUTION_MODE,
  DOCKER_MOUNT_WORKSPACE_CWD,
  EXECUTION_MODES,
  FILE_TOOLS_CWD_SENTINELS,
  GATEWAY_CWD_PLACEHOLDERS,
  HOST_CWD_PREFIXES,
  SSH_DEFAULT_CWD,
} from './agent-cwd'

/** Same candidate list as `resolveClaudeAgentDir`, minus the `webapi` gate —
 *  we only need the Python modules this resolver mirrors. */
function findAgentSource(): string | null {
  const candidates = [
    process.env.CLAUDE_AGENT_PATH?.trim(),
    process.env.HERMES_AGENT_PATH?.trim(),
    resolve(process.cwd(), '..', 'hermes-agent'),
    resolve(homedir(), '.hermes', 'hermes-agent'),
    resolve(homedir(), 'hermes-agent'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'gateway', 'cwd_placeholder.py'))) {
      return candidate
    }
  }
  return null
}

const AGENT_SOURCE = findAgentSource()

/** Parse a `frozenset({...})` / `(...)` literal of string constants. */
function parseStringLiteralSet(source: string, marker: string): Set<string> {
  const at = source.indexOf(marker)
  if (at === -1) {
    throw new Error(
      `Gateway constant "${marker}" no longer exists — the resolver in agent-cwd.ts is ` +
        'mirroring a value that upstream renamed or removed.',
    )
  }
  const open = source.indexOf('{', at)
  const paren = source.indexOf('(', at)
  const start =
    open !== -1 && (paren === -1 || open < paren) ? open : paren
  const close = source.indexOf(open !== -1 && start === open ? '}' : ')', start)
  const body = source.slice(start + 1, close)
  const values = new Set<string>()
  for (const match of body.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    // Strip the surrounding quotes off the whole match rather than picking a
    // capture group — `""` is itself a sentinel, so an empty group is real data.
    values.add(match[0].slice(1, -1).replace(/\\\\/g, '\\'))
  }
  return values
}

function read(relative: string): string {
  if (!AGENT_SOURCE) throw new Error('agent source unavailable')
  return readFileSync(resolve(AGENT_SOURCE, relative), 'utf-8')
}

describe.skipIf(!AGENT_SOURCE)(
  'agent-cwd contract — pinned to the hermes-agent source',
  () => {
    it('GATEWAY_CWD_PLACEHOLDERS matches gateway/cwd_placeholder.py', () => {
      const upstream = parseStringLiteralSet(
        read('gateway/cwd_placeholder.py'),
        'CWD_PLACEHOLDERS',
      )
      expect([...upstream].sort()).toEqual([...GATEWAY_CWD_PLACEHOLDERS].sort())
    })

    it('cli.py mirrors the same placeholder tuple', () => {
      const upstream = parseStringLiteralSet(read('cli.py'), '_CWD_PLACEHOLDERS')
      expect([...upstream].sort()).toEqual([...GATEWAY_CWD_PLACEHOLDERS].sort())
    })

    it('FILE_TOOLS_CWD_SENTINELS matches tools/file_tools.py', () => {
      const upstream = parseStringLiteralSet(
        read('tools/file_tools.py'),
        '_TERMINAL_CWD_SENTINELS',
      )
      expect([...upstream].sort()).toEqual([...FILE_TOOLS_CWD_SENTINELS].sort())
    })

    it('the file-tools sentinel set is still a STRICT superset of the gateway one', () => {
      // The divergence the resolver warns about: `""` and `"./"` are sentinels
      // for file writes but literal relative paths for the gateway bridge. If
      // upstream ever unifies them, the "./" warning becomes wrong.
      for (const value of GATEWAY_CWD_PLACEHOLDERS) {
        expect(FILE_TOOLS_CWD_SENTINELS.has(value)).toBe(true)
      }
      expect(FILE_TOOLS_CWD_SENTINELS.size).toBeGreaterThan(
        GATEWAY_CWD_PLACEHOLDERS.size,
      )
    })

    it('CONTAINER_BACKENDS matches tools/terminal_tool.py', () => {
      const upstream = parseStringLiteralSet(
        read('tools/terminal_tool.py'),
        '_CONTAINER_BACKENDS = frozenset',
      )
      expect([...upstream].sort()).toEqual([...CONTAINER_BACKENDS].sort())
    })

    it('HOST_CWD_PREFIXES matches tools/terminal_tool.py', () => {
      const upstream = parseStringLiteralSet(
        read('tools/terminal_tool.py'),
        '_HOST_CWD_PREFIXES',
      )
      expect([...upstream].sort()).toEqual([...HOST_CWD_PREFIXES].sort())
    })

    it('the per-backend default cwds still read /root, ~ and /workspace', () => {
      const source = read('tools/terminal_tool.py')
      // terminal_tool.py:1387-1392
      expect(source).toMatch(
        /if env_type == "local":\s*\n\s*default_cwd = _safe_getcwd\(\)\s*\n\s*elif env_type == "ssh":\s*\n\s*default_cwd = "~"\s*\n\s*else:\s*\n\s*default_cwd = "\/root"/,
      )
      expect(SSH_DEFAULT_CWD).toBe('~')
      expect(CONTAINER_DEFAULT_CWD).toBe('/root')
      // terminal_tool.py:1409-1410
      expect(source).toMatch(/host_cwd = candidate\s*\n\s*cwd = "\/workspace"/)
      expect(DOCKER_MOUNT_WORKSPACE_CWD).toBe('/workspace')
    })

    it('the local branch of the placeholder resolver still returns home', () => {
      // gateway/cwd_placeholder.py:40-42 — the single line the whole
      // "your agent runs in $HOME" finding rests on.
      expect(read('gateway/cwd_placeholder.py')).toMatch(
        /if backend == "local":\s*\n\s*messaging = \(messaging_cwd or ""\)\.strip\(\)\s*\n\s*return messaging or home_fallback/,
      )
    })

    it('gateway/run.py still passes Path.home() as the home fallback', () => {
      expect(read('gateway/run.py')).toMatch(/home_fallback=str\(Path\.home\(\)\)/)
    })

    it('cli.py still overwrites a local cwd with os.getcwd()', () => {
      // The CLI/gateway divergence the resolver models via `host`.
      expect(read('cli.py')).toMatch(
        /if effective_backend == "local":\s*\n\s*terminal_config\["cwd"\] = os\.getcwd\(\)/,
      )
    })

    it('EXECUTION_MODES matches tools/code_execution_tool.py', () => {
      const source = read('tools/code_execution_tool.py')
      const upstream = parseStringLiteralSet(source, 'EXECUTION_MODES = ')
      expect([...upstream].sort()).toEqual([...EXECUTION_MODES].sort())
      expect(source).toMatch(
        new RegExp(`DEFAULT_EXECUTION_MODE = "${DEFAULT_EXECUTION_MODE}"`),
      )
    })

    it('persistent_shell still bridges only to the SSH default, never local', () => {
      // tools/terminal_tool.py:1438-1444 — local reads TERMINAL_LOCAL_PERSISTENT,
      // which no config key writes, so `persistent_shell: true` is a no-op there.
      const source = read('tools/terminal_tool.py')
      expect(source).toMatch(
        /"ssh_persistent": os\.getenv\(\s*"TERMINAL_SSH_PERSISTENT",\s*os\.getenv\("TERMINAL_PERSISTENT_SHELL", "true"\),/,
      )
      expect(source).toMatch(
        /"local_persistent": os\.getenv\("TERMINAL_LOCAL_PERSISTENT", "false"\)/,
      )
      expect(source).not.toMatch(/TERMINAL_LOCAL_PERSISTENT["']?,?\s*\n?\s*os\.getenv\("TERMINAL_PERSISTENT_SHELL"/)
    })

    it('the gateway HTTP API still has no cwd concept at all', () => {
      // If a `cwd` ever appears in api_server.py, a per-request working
      // directory may have become possible and this whole config-only,
      // restart-required design should be revisited.
      const source = read('gateway/platforms/api_server.py')
      expect(source).not.toMatch(/\bcwd\b/)
      expect(source).not.toMatch(/\bworking_dir\b/)
    })

    it('hermes_cli/config.py still reads only HERMES_HOME/config.yaml (no profile inheritance)', () => {
      expect(read('hermes_cli/config.py')).toMatch(
        /def get_config_path\(\) -> Path:[\s\S]{0,200}?return get_hermes_home\(\) \/ "config\.yaml"/,
      )
    })
  },
)

describe('agent-cwd contract — source discovery', () => {
  it('reports whether the hermes-agent source was available to pin against', () => {
    if (!AGENT_SOURCE) {
      console.warn(
        '[agent-cwd.contract] hermes-agent source not found; gateway constants were ' +
          'NOT verified. Set CLAUDE_AGENT_PATH to enable the contract checks.',
      )
    }
    expect(true).toBe(true)
  })
})
