/**
 * Every check is exercised independently, including its degraded/unknown
 * path, plus the orchestrator's contract that it can never throw.
 *
 * `gateway-capabilities` and `profile-scope` are mocked at module level for
 * one reason beyond convenience: importing the real `gateway-capabilities`
 * fires `ensureGatewayProbed()` and a plugin-sync heartbeat at module load,
 * and its top-level migration block renames a file under the user's real
 * `~/.hermes`. A unit test must not touch a live install.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  checkGatewayProcess,
  checkGatewayReachability,
  checkGatewayToken,
  checkProfileConfig,
  checkProfileEnv,
  checkServingProfile,
  fingerprint,
  hasInstallEvidence,
  listMissingCapabilities,
  profileHomeFor,
  readActiveProfileName,
  readGatewayStateFile,
  readTopLevelConfigKeys,
  runSetupDiagnostics,
  worstSeverity,
} from './setup-diagnostics'
import type { GatewayCapabilities } from './gateway-capabilities'

// `vi.mock` is hoisted above the imports above at transform time, so these
// stubs are in place before `./setup-diagnostics` pulls either module in.
vi.mock('./gateway-capabilities', () => ({
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('./profile-scope', () => ({
  getGatewayMode: vi.fn(),
}))

// ── Fixtures ──────────────────────────────────────────────────────

let root: string

function write(relative: string, content: string): string {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  return target
}

const ROOT_ENV = [
  '# comment line',
  'API_SERVER_ENABLED=true',
  'API_SERVER_KEY=super-secret-key',
  'OPENAI_API_KEY=sk-abc',
  '',
].join('\n')

const ROOT_CONFIG = [
  'model:',
  '  default: auto',
  'agent:',
  '  loop: true',
  'terminal: {}',
  'memory: {}',
  'skills: {}',
  'streaming: {}',
  'plugins: {}',
].join('\n')

const BARE_PROFILE_CONFIG = [
  'description: seeded',
  'model:',
  '  default: auto',
].join('\n')

const baseCaps = (): GatewayCapabilities => ({
  health: true,
  chatCompletions: true,
  chatCompletionsRouteExists: true,
  models: true,
  streaming: true,
  probed: true,
  authError: false,
  sessions: true,
  enhancedChat: true,
  skills: true,
  memory: true,
  config: true,
  jobs: true,
  mcp: true,
  mcpFallback: false,
  conductor: true,
  kanban: true,
  projects: true,
  dashboard: { available: true, url: 'http://127.0.0.1:9119' },
})

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-diag-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ── Primitives ────────────────────────────────────────────────────

describe('primitives', () => {
  it('readActiveProfileName defaults to "default" when nothing is selected', () => {
    expect(readActiveProfileName(root)).toBe('default')
    write('active_profile', '  hermes-switch\n')
    expect(readActiveProfileName(root)).toBe('hermes-switch')
  })

  it('profileHomeFor maps default to the root and a named profile to profiles/<name>', () => {
    expect(profileHomeFor(root, 'default')).toBe(root)
    expect(profileHomeFor(root, '')).toBe(root)
    expect(profileHomeFor(root, 'neo')).toBe(path.join(root, 'profiles', 'neo'))
  })

  it('readTopLevelConfigKeys returns null for an absent file and keys otherwise', () => {
    expect(readTopLevelConfigKeys(path.join(root, 'nope.yaml'))).toBeNull()
    const p = write('config.yaml', ROOT_CONFIG)
    expect(readTopLevelConfigKeys(p)).toEqual([
      'model',
      'agent',
      'terminal',
      'memory',
      'skills',
      'streaming',
      'plugins',
    ])
  })

  it('readTopLevelConfigKeys falls back to a line scan on unparseable YAML', () => {
    const p = write('broken.yaml', 'model:\n\tbad: [unclosed\nagent: x')
    const keys = readTopLevelConfigKeys(p)
    expect(keys).toContain('model')
    expect(keys).toContain('agent')
  })

  it('fingerprint is stable, short, and not the value', () => {
    const fp = fingerprint('super-secret-key')
    expect(fp).toHaveLength(12)
    expect(fp).toBe(fingerprint('super-secret-key'))
    expect(fp).not.toContain('secret')
    expect(fingerprint('')).toBe('')
  })

  it('worstSeverity ranks a known warning above an unchecked unknown', () => {
    expect(
      worstSeverity([
        { id: 'a', severity: 'unknown', title: '' },
        { id: 'b', severity: 'warning', title: '' },
      ]),
    ).toBe('warning')
    expect(
      worstSeverity([
        { id: 'a', severity: 'unknown', title: '' },
        { id: 'b', severity: 'info', title: '' },
      ]),
    ).toBe('unknown')
    expect(worstSeverity([])).toBe('ok')
  })
})

// ── Check: reachability ───────────────────────────────────────────

describe('checkGatewayReachability', () => {
  it('separates a 401 (token mismatch) from an outage', () => {
    const finding = checkGatewayReachability(
      { ...baseCaps(), health: false, chatCompletions: false, authError: true },
      'http://127.0.0.1:8642',
    )
    expect(finding.severity).toBe('error')
    expect(finding.title).toContain('rejecting')
    expect(finding.data?.reachable).toBe(true)
    // The point of the distinction: this is NOT "nothing listening".
    expect(finding.title).not.toContain('Nothing is listening')
  })

  it('reports nothing listening when the probe got no reply at all', () => {
    const finding = checkGatewayReachability(
      { health: false, chatCompletions: false, authError: false, probed: true },
      'http://127.0.0.1:8642',
    )
    expect(finding.severity).toBe('error')
    expect(finding.title).toContain('Nothing is listening')
    expect(finding.data?.reachable).toBe(false)
  })

  it('reports ok when healthy', () => {
    const finding = checkGatewayReachability(
      baseCaps(),
      'http://127.0.0.1:8642',
    )
    expect(finding.severity).toBe('ok')
  })

  it('degrades to unknown when the probe has not run', () => {
    const finding = checkGatewayReachability(
      {
        health: false,
        chatCompletions: false,
        authError: false,
        probed: false,
      },
      'http://127.0.0.1:8642',
    )
    expect(finding.severity).toBe('unknown')
  })
})

// ── Check: gateway process ────────────────────────────────────────

describe('checkGatewayProcess', () => {
  const runningState = (platforms: Record<string, unknown>) =>
    JSON.stringify({
      pid: 5376,
      kind: 'hermes-gateway',
      gateway_state: 'running',
      platforms,
      updated_at: '2026-08-10T01:43:29Z',
    })

  it('readGatewayStateFile flattens the platform state map', () => {
    write(
      'gateway_state.json',
      runningState({
        api_server: { state: 'connected' },
        a2a_fleet: { state: 'connected' },
      }),
    )
    const state = readGatewayStateFile(root)
    expect(state?.pid).toBe(5376)
    expect(state?.platforms).toEqual({
      api_server: 'connected',
      a2a_fleet: 'connected',
    })
  })

  it('THE case: a live process with no bound api_server must not invite Auto-Start', () => {
    write('active_profile', 'hermes-switch')
    write('profiles/hermes-switch/gateway_state.json', runningState({}))

    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'hermes-switch',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => true,
      verifyPidIdentity: () => true,
    })

    expect(result.running).toBe(true)
    expect(result.finding.severity).toBe('error')
    expect(result.finding.title).toContain('already running')
    expect(result.finding.detail).toContain('no active services at all')
    expect(result.finding.remedy).toContain('Do not start a second copy')
    expect(result.liveHome).toBe(path.join(root, 'profiles', 'hermes-switch'))
  })

  it('a live process that DOES report api_server but is unreachable blames the address', () => {
    write(
      'gateway_state.json',
      runningState({ api_server: { state: 'connected' } }),
    )
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => true,
      verifyPidIdentity: () => true,
    })
    expect(result.running).toBe(true)
    expect(result.finding.severity).toBe('error')
    expect(result.finding.remedy).toContain('HERMES_API_URL')
  })

  it('a dead pid means nothing is running, so Auto-Start is the right offer', () => {
    write(
      'gateway_state.json',
      runningState({ api_server: { state: 'connected' } }),
    )
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => false,
    })
    expect(result.running).toBe(false)
    expect(result.finding.title).toContain('not running right now')
  })

  it('no state file at all reports "no record" rather than a false negative', () => {
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => true,
    })
    expect(result.running).toBe(false)
    expect(result.finding.title).toContain('No Hermes Agent process')
  })

  it('hedges the copy when the pid cannot be confirmed as a Hermes process', () => {
    write('gateway_state.json', runningState({}))
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => true,
      verifyPidIdentity: () => false,
    })
    expect(result.finding.detail).toContain('may have been reused')
    expect(result.finding.data?.pidVerified).toBe(false)
  })

  it('degrades to unknown (running: null) when the liveness probe throws', () => {
    write('gateway_state.json', runningState({}))
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: false,
      isProcessAlive: () => {
        throw new Error('boom')
      },
    })
    expect(result.running).toBeNull()
    expect(result.finding.severity).toBe('unknown')
  })

  it('says ok when a live process is also answering', () => {
    write(
      'gateway_state.json',
      runningState({ api_server: { state: 'connected' } }),
    )
    const result = checkGatewayProcess({
      hermesRoot: root,
      activeProfile: 'default',
      gatewayUrl: 'http://127.0.0.1:8642',
      gatewayReachable: true,
      isProcessAlive: () => true,
      verifyPidIdentity: () => true,
    })
    expect(result.running).toBe(true)
    expect(result.finding.severity).toBe('ok')
  })
})

// ── Check: profile .env (the footgun) ─────────────────────────────

describe('checkProfileEnv', () => {
  it('flags an empty profile .env against a populated root one', () => {
    write('.env', ROOT_ENV)
    write('profiles/hermes-switch/.env', '')

    const finding = checkProfileEnv({
      hermesRoot: root,
      activeProfile: 'hermes-switch',
    })

    expect(finding.severity).toBe('error')
    expect(finding.title).toContain('"hermes-switch"')
    expect(finding.title).toContain('an empty settings file')
    // Both paths must be named — that is what makes it fixable in seconds.
    expect(finding.detail).toContain(
      path.join(root, 'profiles', 'hermes-switch', '.env'),
    )
    expect(finding.detail).toContain(path.join(root, '.env'))
    expect(finding.detail).toContain('does not fall back')
    expect(finding.detail).toContain('API_SERVER_ENABLED')
    expect(finding.remedy).toContain('cp ')
    expect(finding.data?.rootSettingCount).toBe(3)
    expect(finding.data?.profileSettingCount).toBe(0)
  })

  it('distinguishes a missing profile .env from an empty one', () => {
    write('.env', ROOT_ENV)
    fs.mkdirSync(path.join(root, 'profiles', 'neo'), { recursive: true })
    const finding = checkProfileEnv({ hermesRoot: root, activeProfile: 'neo' })
    expect(finding.severity).toBe('error')
    expect(finding.title).toContain('no settings file at all')
    expect(finding.data?.profileEnvExists).toBe(false)
  })

  it('is ok when the default profile is active — nothing is shadowing the root', () => {
    write('.env', ROOT_ENV)
    const finding = checkProfileEnv({
      hermesRoot: root,
      activeProfile: 'default',
    })
    expect(finding.severity).toBe('ok')
  })

  it('warns (not errors) when the profile has settings but is missing some of the root ones', () => {
    write('.env', ROOT_ENV)
    write('profiles/neo/.env', 'API_SERVER_ENABLED=true\n')
    const finding = checkProfileEnv({ hermesRoot: root, activeProfile: 'neo' })
    expect(finding.severity).toBe('warning')
    expect(finding.data?.missingKeys).toEqual([
      'API_SERVER_KEY',
      'OPENAI_API_KEY',
    ])
  })

  it('is ok when the profile carries every root setting', () => {
    write('.env', ROOT_ENV)
    write('profiles/neo/.env', ROOT_ENV)
    expect(
      checkProfileEnv({ hermesRoot: root, activeProfile: 'neo' }).severity,
    ).toBe('ok')
  })

  it('degrades to info, not error, when neither side has any settings (fresh machine)', () => {
    const finding = checkProfileEnv({ hermesRoot: root, activeProfile: 'neo' })
    expect(finding.severity).toBe('info')
  })
})

// ── Check: profile config.yaml ────────────────────────────────────

describe('checkProfileConfig', () => {
  it('flags a bare seeded profile config against a full root config', () => {
    write('config.yaml', ROOT_CONFIG)
    write('profiles/hermes-switch/config.yaml', BARE_PROFILE_CONFIG)

    const finding = checkProfileConfig({
      hermesRoot: root,
      activeProfile: 'hermes-switch',
    })

    expect(finding.severity).toBe('warning')
    expect(finding.data?.profileKeyCount).toBe(2)
    expect(finding.data?.rootKeyCount).toBe(7)
    expect(finding.detail).toContain('agent')
    expect(finding.detail).toContain('skills')
    expect(finding.remedy).toContain(path.join(root, 'config.yaml'))
  })

  it('does not shout at a profile that merely overrides a few sections', () => {
    write('config.yaml', ROOT_CONFIG)
    write(
      'profiles/neo/config.yaml',
      [
        'model:',
        '  default: auto',
        'agent: {}',
        'terminal: {}',
        'memory: {}',
        'skills: {}',
      ].join('\n'),
    )
    expect(
      checkProfileConfig({ hermesRoot: root, activeProfile: 'neo' }).severity,
    ).toBe('ok')
  })

  it('reports an absent profile config as a warning naming the root one', () => {
    write('config.yaml', ROOT_CONFIG)
    const finding = checkProfileConfig({
      hermesRoot: root,
      activeProfile: 'neo',
    })
    expect(finding.severity).toBe('warning')
    expect(finding.detail).toContain(path.join(root, 'config.yaml'))
  })

  it('degrades to info when there is no root config to compare against', () => {
    const finding = checkProfileConfig({
      hermesRoot: root,
      activeProfile: 'neo',
    })
    expect(finding.severity).toBe('info')
  })

  it('is ok for the default profile', () => {
    write('config.yaml', ROOT_CONFIG)
    expect(
      checkProfileConfig({ hermesRoot: root, activeProfile: 'default' })
        .severity,
    ).toBe('ok')
  })
})

// ── Check: selected vs serving ────────────────────────────────────

describe('checkServingProfile', () => {
  it('flags a pending restart when the selection differs from what is served', () => {
    const finding = checkServingProfile({
      selectedProfile: 'hermes-switch',
      servingProfile: 'default',
      scopeMode: 'single',
      servedProfiles: null,
    })
    expect(finding.severity).toBe('warning')
    expect(finding.title).toContain('hermes-switch')
    expect(finding.title).toContain('default')
    expect(finding.remedy).toContain('Restart')
  })

  it('is ok when they agree', () => {
    expect(
      checkServingProfile({
        selectedProfile: 'neo',
        servingProfile: 'neo',
        scopeMode: 'single',
        servedProfiles: null,
      }).severity,
    ).toBe('ok')
  })

  it('under multiplex, flags a profile the gateway does not serve', () => {
    const finding = checkServingProfile({
      selectedProfile: 'trinity',
      servingProfile: null,
      scopeMode: 'multiplex',
      servedProfiles: ['default', 'neo'],
    })
    expect(finding.severity).toBe('warning')
    expect(finding.detail).toContain('default, neo')
  })

  it('degrades to unknown rather than guessing when topology could not be read', () => {
    const finding = checkServingProfile({
      selectedProfile: 'neo',
      servingProfile: null,
      scopeMode: 'unknown',
      servedProfiles: null,
    })
    expect(finding.severity).toBe('unknown')
  })
})

// ── Check: access key ─────────────────────────────────────────────

describe('checkGatewayToken', () => {
  it('compares by fingerprint and never returns a value', () => {
    write('.env', ROOT_ENV)
    write('profiles/neo/.env', 'API_SERVER_KEY=a-different-key\n')

    const finding = checkGatewayToken({
      workspaceToken: 'super-secret-key',
      gatewayEnvPath: path.join(root, 'profiles', 'neo', '.env'),
      rootEnvPath: path.join(root, '.env'),
      authError: true,
    })

    expect(finding.severity).toBe('error')
    const serialized = JSON.stringify(finding)
    expect(serialized).not.toContain('super-secret-key')
    expect(serialized).not.toContain('a-different-key')
    expect(finding.data?.workspaceTokenFingerprint).toBe(
      fingerprint('super-secret-key'),
    )
    expect(finding.data?.gatewayKeyFingerprint).toBe(
      fingerprint('a-different-key'),
    )
  })

  it('is ok when both sides carry the same key', () => {
    write('.env', ROOT_ENV)
    const finding = checkGatewayToken({
      workspaceToken: 'super-secret-key',
      gatewayEnvPath: path.join(root, '.env'),
      rootEnvPath: path.join(root, '.env'),
      authError: false,
    })
    expect(finding.severity).toBe('ok')
  })

  it('catches the profile-shadowing variant: root defines a key, the gateway file does not', () => {
    write('.env', ROOT_ENV)
    write('profiles/neo/.env', '')
    const finding = checkGatewayToken({
      workspaceToken: '',
      gatewayEnvPath: path.join(root, 'profiles', 'neo', '.env'),
      rootEnvPath: path.join(root, '.env'),
      authError: false,
    })
    expect(finding.severity).toBe('warning')
    expect(finding.remedy).toContain('API_SERVER_ENABLED')
  })

  it('is ok when neither side uses a key at all', () => {
    write('.env', 'OPENAI_API_KEY=sk-x\n')
    const finding = checkGatewayToken({
      workspaceToken: '',
      gatewayEnvPath: path.join(root, '.env'),
      rootEnvPath: path.join(root, '.env'),
      authError: false,
    })
    expect(finding.severity).toBe('ok')
  })

  it('errors when the gateway requires a key and the app sends none', () => {
    write('.env', ROOT_ENV)
    const finding = checkGatewayToken({
      workspaceToken: '',
      gatewayEnvPath: path.join(root, '.env'),
      rootEnvPath: path.join(root, '.env'),
      authError: false,
    })
    expect(finding.severity).toBe('error')
    expect(finding.title).toContain('not sending one')
  })

  it('treats an unreadable env file as "no key" rather than throwing', () => {
    const finding = checkGatewayToken({
      workspaceToken: 'x',
      gatewayEnvPath: path.join(root, 'does', 'not', 'exist', '.env'),
      rootEnvPath: path.join(root, 'nope', '.env'),
      authError: false,
    })
    expect(finding.severity).toBe('warning')
  })
})

// ── Capabilities + install evidence ───────────────────────────────

describe('capability + install helpers', () => {
  it('names the capabilities that are missing', () => {
    const caps = {
      ...baseCaps(),
      health: false,
      models: false,
      dashboard: { available: false, url: '' },
    }
    const missing = listMissingCapabilities(caps)
    expect(missing).toContain('health')
    expect(missing).toContain('models')
    expect(missing).toContain('dashboard')
    expect(missing).not.toContain('sessions')
  })

  it('an empty directory is a first run; any marker is not', () => {
    expect(hasInstallEvidence(root)).toBe(false)
    write('active_profile', 'default')
    expect(hasInstallEvidence(root)).toBe(true)
  })

  it('a profiles directory with entries counts as an install', () => {
    fs.mkdirSync(path.join(root, 'profiles', 'neo'), { recursive: true })
    expect(hasInstallEvidence(root)).toBe(true)
  })

  it('a non-existent root is a first run', () => {
    expect(hasInstallEvidence(path.join(root, 'missing'))).toBe(false)
  })
})

// ── Orchestrator ──────────────────────────────────────────────────

describe('runSetupDiagnostics', () => {
  it('reproduces the live failure end to end', async () => {
    write('active_profile', 'hermes-switch')
    write('.env', ROOT_ENV)
    write('config.yaml', ROOT_CONFIG)
    write('profiles/hermes-switch/.env', '')
    write('profiles/hermes-switch/config.yaml', BARE_PROFILE_CONFIG)
    write(
      'profiles/hermes-switch/gateway_state.json',
      JSON.stringify({ pid: 5376, gateway_state: 'running', platforms: {} }),
    )

    const result = await runSetupDiagnostics({
      hermesRoot: root,
      gatewayUrl: 'http://127.0.0.1:8642',
      capabilities: () =>
        Promise.resolve({
          ...baseCaps(),
          health: false,
          chatCompletions: false,
          models: false,
          streaming: false,
          enhancedChat: false,
        }),
      scope: () =>
        Promise.resolve({
          mode: 'unknown',
          servedProfiles: null,
          activeProfile: null,
        }),
      workspaceToken: 'super-secret-key',
      isProcessAlive: () => true,
      verifyPidIdentity: () => true,
    })

    expect(result.severity).toBe('error')
    expect(result.firstRun).toBe(false)
    // The single most important output: do NOT offer to start a second one.
    expect(result.gatewayProcessRunning).toBe(true)
    expect(result.missingCapabilities).toContain('health')
    expect(result.missingCapabilities).toContain('chatCompletions')

    const ids = result.findings.map((f) => f.id)
    expect(ids).toEqual([
      'gateway-reachability',
      'gateway-process',
      'profile-env',
      'profile-config',
      'profile-serving',
      'gateway-token',
    ])
    expect(result.findings.find((f) => f.id === 'profile-env')?.severity).toBe(
      'error',
    )
    expect(
      result.findings.find((f) => f.id === 'gateway-process')?.severity,
    ).toBe('error')
  })

  it('reports a clean healthy install with no problems', async () => {
    write('active_profile', 'default')
    write('.env', ROOT_ENV)
    write('config.yaml', ROOT_CONFIG)
    write(
      'gateway_state.json',
      JSON.stringify({
        pid: 42,
        gateway_state: 'running',
        platforms: { api_server: { state: 'connected' } },
      }),
    )

    const result = await runSetupDiagnostics({
      hermesRoot: root,
      capabilities: () => Promise.resolve(baseCaps()),
      scope: () =>
        Promise.resolve({
          mode: 'single',
          servedProfiles: null,
          activeProfile: 'default',
        }),
      workspaceToken: 'super-secret-key',
      isProcessAlive: () => true,
      verifyPidIdentity: () => true,
    })

    expect(result.severity).toBe('ok')
    expect(result.findings.every((f) => f.severity === 'ok')).toBe(true)
    expect(result.gatewayProcessRunning).toBe(true)
  })

  it('a reachable backend whose process is invisible is a note, not a problem', async () => {
    write('active_profile', 'default')
    write('.env', ROOT_ENV)
    write('config.yaml', ROOT_CONFIG)

    const result = await runSetupDiagnostics({
      hermesRoot: root,
      capabilities: () => Promise.resolve(baseCaps()),
      scope: () =>
        Promise.resolve({
          mode: 'single',
          servedProfiles: null,
          activeProfile: 'default',
        }),
      workspaceToken: 'super-secret-key',
      isProcessAlive: () => false,
    })

    // 'info', never 'warning'/'error': a remote or containerised gateway that
    // answers is working, it just does not write a state file we can see.
    expect(result.severity).toBe('info')
    expect(
      result.findings.find((f) => f.id === 'gateway-process')?.severity,
    ).toBe('info')
  })

  it('marks a genuinely empty machine as a first run', async () => {
    const result = await runSetupDiagnostics({
      hermesRoot: path.join(root, 'never-installed'),
      capabilities: () =>
        Promise.resolve({
          ...baseCaps(),
          health: false,
          chatCompletions: false,
        }),
      scope: () =>
        Promise.resolve({
          mode: 'unknown',
          servedProfiles: null,
          activeProfile: null,
        }),
      workspaceToken: '',
      isProcessAlive: () => false,
    })
    expect(result.firstRun).toBe(true)
    expect(result.gatewayProcessRunning).toBe(false)
  })

  it('never throws when every underlying read fails', async () => {
    const result = await runSetupDiagnostics({
      hermesRoot: '\0/definitely/not/a/path',
      capabilities: () => Promise.reject(new Error('probe exploded')),
      scope: () => Promise.reject(new Error('topology exploded')),
      workspaceToken: 'x',
      isProcessAlive: () => {
        throw new Error('kill exploded')
      },
      verifyPidIdentity: () => {
        throw new Error('proc exploded')
      },
    })

    expect(result.findings.length).toBeGreaterThan(0)
    expect(result.missingCapabilities).toEqual([])
    // Unknown, never a confident false: a crashed diagnosis must not put the
    // useless Auto-Start button back on the screen.
    expect(result.gatewayProcessRunning).not.toBe(true)
    expect(
      result.findings.find((f) => f.id === 'gateway-reachability')?.severity,
    ).toBe('unknown')
    expect(
      result.findings.find((f) => f.id === 'profile-serving')?.severity,
    ).toBe('unknown')
  })

  it('degrades each check independently — one failure does not hide the others', async () => {
    write('active_profile', 'hermes-switch')
    write('.env', ROOT_ENV)
    write('profiles/hermes-switch/.env', '')

    const result = await runSetupDiagnostics({
      hermesRoot: root,
      capabilities: () => Promise.reject(new Error('probe exploded')),
      scope: () => Promise.reject(new Error('topology exploded')),
      workspaceToken: 'super-secret-key',
      isProcessAlive: () => false,
    })

    // Reachability + serving are unknown, but the profile footgun is still found.
    expect(
      result.findings.find((f) => f.id === 'gateway-reachability')?.severity,
    ).toBe('unknown')
    expect(
      result.findings.find((f) => f.id === 'profile-serving')?.severity,
    ).toBe('unknown')
    expect(result.findings.find((f) => f.id === 'profile-env')?.severity).toBe(
      'error',
    )
  })
})
