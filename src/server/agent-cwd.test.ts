import { describe, expect, it } from 'vitest'
import {
  CONTAINER_DEFAULT_CWD,
  DOCKER_MOUNT_WORKSPACE_CWD,
  EMPTY_TERMINAL_CONFIG,
  SSH_DEFAULT_CWD,
  isCwdPlaceholder,
  isUnusableContainerCwd,
  readTerminalConfig,
  resolveAgentCwd,
  validateAgentCwd,
} from './agent-cwd'
import type {
  AgentCwdSource,
  ProfileTerminalConfig,
  ResolveAgentCwdInput,
} from './agent-cwd'

const HOME = '/home/tester'

function terminal(
  overrides: Partial<ProfileTerminalConfig> = {},
): ProfileTerminalConfig {
  return { ...EMPTY_TERMINAL_CONFIG, present: true, ...overrides }
}

function resolve(overrides: Partial<ResolveAgentCwdInput> = {}) {
  return resolveAgentCwd({
    profile: 'default',
    config: terminal(),
    homeDir: HOME,
    ...overrides,
  })
}

// ── The resolution ladder, case by case ────────────────────────────────────

describe('resolveAgentCwd — the gateway ladder', () => {
  type Row = {
    name: string
    input: Partial<ResolveAgentCwdInput>
    path: string | null
    source: AgentCwdSource
    backend: string
  }

  const rows: Array<Row> = [
    {
      // gateway/cwd_placeholder.py:40-42 — the headline case.
      name: 'sentinel "." + local backend resolves to $HOME, not a relative path',
      input: { config: terminal({ cwd: '.', backend: 'local' }) },
      path: HOME,
      source: 'home-sentinel',
      backend: 'local',
    },
    {
      name: 'sentinel "auto" behaves identically to "."',
      input: { config: terminal({ cwd: 'auto', backend: 'local' }) },
      path: HOME,
      source: 'home-sentinel',
      backend: 'local',
    },
    {
      name: 'sentinel "cwd" behaves identically to "."',
      input: { config: terminal({ cwd: 'cwd', backend: 'local' }) },
      path: HOME,
      source: 'home-sentinel',
      backend: 'local',
    },
    {
      name: 'an absent cwd with a terminal block still lands on $HOME',
      input: { config: terminal({ backend: 'local' }) },
      path: HOME,
      source: 'home-sentinel',
      backend: 'local',
    },
    {
      name: 'an absent backend defaults to local',
      input: { config: terminal({ cwd: '.' }) },
      path: HOME,
      source: 'home-sentinel',
      backend: 'local',
    },
    {
      name: 'an explicit absolute path is bridged verbatim',
      input: {
        config: terminal({ cwd: '/srv/project', backend: 'local' }),
      },
      path: '/srv/project',
      source: 'explicit-config',
      backend: 'local',
    },
    {
      name: 'an explicit ~ path is expanded against home for local',
      input: { config: terminal({ cwd: '~/code/app', backend: 'local' }) },
      path: `${HOME}/code/app`,
      source: 'explicit-config',
      backend: 'local',
    },
    {
      // MESSAGING_CWD is the deprecated back-compat fallback (run.py:1898).
      name: 'MESSAGING_CWD wins over the $HOME fallback on local',
      input: {
        config: terminal({ cwd: '.', backend: 'local' }),
        messagingCwd: '/srv/legacy',
      },
      path: '/srv/legacy',
      source: 'explicit-config',
      backend: 'local',
    },
    {
      // gateway/cwd_placeholder.py:47 — no TERMINAL_CWD is set at all.
      name: 'docker + sentinel gets no TERMINAL_CWD, so /root inside the sandbox',
      input: { config: terminal({ cwd: '.', backend: 'docker' }) },
      path: CONTAINER_DEFAULT_CWD,
      source: 'container-default',
      backend: 'docker',
    },
    {
      name: 'modal + sentinel also falls to the container default',
      input: { config: terminal({ cwd: '.', backend: 'modal' }) },
      path: CONTAINER_DEFAULT_CWD,
      source: 'container-default',
      backend: 'modal',
    },
    {
      name: 'MESSAGING_CWD does NOT rescue a container backend without the mount flag',
      input: {
        config: terminal({ cwd: '.', backend: 'singularity' }),
        messagingCwd: '/srv/legacy',
      },
      path: CONTAINER_DEFAULT_CWD,
      source: 'container-default',
      backend: 'singularity',
    },
    {
      name: 'ssh + sentinel uses the remote home, not /root',
      input: { config: terminal({ cwd: '.', backend: 'ssh' }) },
      path: SSH_DEFAULT_CWD,
      source: 'container-default',
      backend: 'ssh',
    },
    {
      name: 'ssh keeps a ~ path unexpanded — the REMOTE shell expands it',
      input: { config: terminal({ cwd: '~/remote', backend: 'ssh' }) },
      path: '~/remote',
      source: 'explicit-config',
      backend: 'ssh',
    },
    {
      // terminal_tool.py:1411-1417
      name: 'a host path on a container backend is discarded for /root',
      input: {
        config: terminal({ cwd: '/home/tester/app', backend: 'docker' }),
      },
      path: CONTAINER_DEFAULT_CWD,
      source: 'container-default',
      backend: 'docker',
    },
    {
      name: 'an in-sandbox absolute path on a container backend is kept',
      input: { config: terminal({ cwd: '/opt/app', backend: 'docker' }) },
      path: '/opt/app',
      source: 'explicit-config',
      backend: 'docker',
    },
    {
      // terminal_tool.py:1403-1410
      name: 'docker + mount remaps the host path to /workspace',
      input: {
        config: terminal({
          cwd: '/home/tester/app',
          backend: 'docker',
          dockerMountCwdToWorkspace: true,
        }),
      },
      path: DOCKER_MOUNT_WORKSPACE_CWD,
      source: 'container-default',
      backend: 'docker',
    },
    {
      name: 'an unknown backend gets the /root default like any sandbox',
      input: { config: terminal({ cwd: '.', backend: 'kubernetes' }) },
      path: CONTAINER_DEFAULT_CWD,
      source: 'container-default',
      backend: 'kubernetes',
    },
  ]

  for (const row of rows) {
    it(row.name, () => {
      const result = resolve(row.input)
      expect(result.path).toBe(row.path)
      expect(result.source).toBe(row.source)
      expect(result.backend).toBe(row.backend)
    })
  }
})

// ── CLI vs gateway divergence ──────────────────────────────────────────────

describe('resolveAgentCwd — CLI/TUI divergence', () => {
  it('the same "." resolves to $HOME in the gateway but the process cwd in the CLI', () => {
    const config = terminal({ cwd: '.', backend: 'local' })
    const gateway = resolve({ config, host: 'gateway' })
    const cli = resolve({ config, host: 'cli', cliProcessCwd: '/tmp/somewhere' })

    expect(gateway.path).toBe(HOME)
    expect(gateway.source).toBe('home-sentinel')
    expect(cli.path).toBe('/tmp/somewhere')
    expect(cli.source).toBe('unknown')
  })

  it('the CLI reports "unknown" when the invoking directory is not supplied', () => {
    const cli = resolve({
      config: terminal({ cwd: '.', backend: 'local' }),
      host: 'cli',
    })
    expect(cli.path).toBeNull()
    expect(cli.source).toBe('unknown')
  })

  it('the CLI discards an EXPLICIT local path (cli.py:651 overwrites it)', () => {
    const cli = resolve({
      config: terminal({ cwd: '/srv/project', backend: 'local' }),
      host: 'cli',
      cliProcessCwd: '/tmp/elsewhere',
    })
    expect(cli.path).toBe('/tmp/elsewhere')
    expect(cli.source).toBe('unknown')
    expect(cli.warnings.join('\n')).toMatch(/cli\.py:651/)
  })

  it('the CLI matches the gateway for non-local backends', () => {
    const config = terminal({ cwd: '.', backend: 'docker' })
    expect(resolve({ config, host: 'cli' }).path).toBe(
      resolve({ config, host: 'gateway' }).path,
    )
  })

  it('the CLI has no MESSAGING_CWD fallback', () => {
    const config = terminal({ cwd: '.', backend: 'local' })
    const cli = resolve({ config, host: 'cli', messagingCwd: '/srv/legacy' })
    expect(cli.path).not.toBe('/srv/legacy')
  })
})

// ── Multiplex: per-profile terminal settings are ignored ───────────────────

describe('resolveAgentCwd — multiplex non-launch profile', () => {
  const scoped = terminal({ cwd: '/srv/scoped', backend: 'local' })
  const launch = terminal({ cwd: '/srv/launch', backend: 'local' })

  it('reports the LAUNCH profile value, never the scoped profile own value', () => {
    const result = resolve({
      profile: 'research',
      config: scoped,
      multiplex: true,
      launchProfile: 'default',
      launchConfig: launch,
    })
    expect(result.path).toBe('/srv/launch')
    expect(result.profile).toBe('default')
    expect(result.warnings.join('\n')).toMatch(
      /multiplexes profiles.*LAUNCH profile "default"/s,
    )
  })

  it('a scoped profile whose launch profile has no terminal block still lands on $HOME', () => {
    const result = resolve({
      profile: 'research',
      config: scoped,
      multiplex: true,
      launchProfile: 'default',
      launchConfig: null,
    })
    expect(result.path).toBe(HOME)
    expect(result.source).toBe('home-sentinel')
    expect(result.profile).toBe('default')
  })

  it('uses the profile own config when it IS the launch profile', () => {
    const result = resolve({
      profile: 'default',
      config: launch,
      multiplex: true,
      launchProfile: 'default',
      launchConfig: launch,
    })
    expect(result.path).toBe('/srv/launch')
    expect(result.profile).toBe('default')
    expect(result.warnings.join('\n')).not.toMatch(/multiplexes profiles/)
  })

  it('refuses to answer when multiplexing but the launch profile is unknown', () => {
    const result = resolve({
      profile: 'research',
      config: scoped,
      multiplex: true,
      launchProfile: null,
    })
    expect(result.path).toBeNull()
    expect(result.source).toBe('unknown')
  })

  it('without multiplexing, a non-active profile answers from its own config', () => {
    const result = resolve({
      profile: 'research',
      config: scoped,
      multiplex: false,
      launchProfile: 'default',
      launchConfig: launch,
    })
    expect(result.path).toBe('/srv/scoped')
    expect(result.profile).toBe('research')
  })
})

// ── The inheritance gap ────────────────────────────────────────────────────

describe('resolveAgentCwd — profiles do not inherit', () => {
  it('warns plainly that a profile with no terminal: block runs in $HOME', () => {
    const result = resolve({
      profile: 'research',
      config: EMPTY_TERMINAL_CONFIG,
    })
    expect(result.path).toBe(HOME)
    expect(result.source).toBe('home-sentinel')
    const text = result.warnings.join('\n')
    expect(text).toMatch(/no `terminal:` block/)
    expect(text).toMatch(/do NOT inherit/)
  })

  it('does not raise the inheritance warning when the block exists', () => {
    const result = resolve({ config: terminal({ cwd: '/srv/x' }) })
    expect(result.warnings.join('\n')).not.toMatch(/no `terminal:` block/)
  })
})

// ── Warnings for adjacent settings that follow the same ladder ─────────────

describe('resolveAgentCwd — adjacent settings', () => {
  it('warns that execute_code also runs in $HOME under the default project mode', () => {
    const result = resolve({ config: terminal({ cwd: '.', backend: 'local' }) })
    expect(result.warnings.join('\n')).toMatch(/execute_code also runs/)
  })

  it('does not warn about execute_code in strict mode', () => {
    const result = resolve({
      config: terminal({ cwd: '.', backend: 'local' }),
      codeExecutionMode: 'strict',
    })
    expect(result.warnings.join('\n')).not.toMatch(/execute_code also runs/)
  })

  it('warns that persistent_shell is a no-op on local', () => {
    const result = resolve({
      config: terminal({ cwd: '/srv/x', backend: 'local', persistentShell: true }),
    })
    expect(result.warnings.join('\n')).toMatch(/persistent_shell: true is a no-op/)
  })

  it('does not warn about persistent_shell on ssh, where it IS read', () => {
    const result = resolve({
      config: terminal({ cwd: '/srv/x', backend: 'ssh', persistentShell: true }),
    })
    expect(result.warnings.join('\n')).not.toMatch(/no-op/)
  })

  it('names MESSAGING_CWD as the provenance when it supplies the path', () => {
    const result = resolve({
      config: terminal({ cwd: '.', backend: 'local' }),
      messagingCwd: '/srv/legacy',
    })
    expect(result.warnings.join('\n')).toMatch(/MESSAGING_CWD/)
  })
})

// ── The gateway/file-tools sentinel divergence ─────────────────────────────

describe('resolveAgentCwd — "./" is not a gateway sentinel', () => {
  it('refuses to guess for a relative local path and explains the divergence', () => {
    const result = resolve({ config: terminal({ cwd: './', backend: 'local' }) })
    expect(result.path).toBeNull()
    expect(result.source).toBe('unknown')
    const text = result.warnings.join('\n')
    expect(text).toMatch(/RELATIVE path/)
    expect(text).toMatch(/file_tools\.py:166/)
  })

  it('also refuses for a bare relative segment', () => {
    const result = resolve({ config: terminal({ cwd: 'src', backend: 'local' }) })
    expect(result.path).toBeNull()
    expect(result.source).toBe('unknown')
  })
})

// ── Helpers ────────────────────────────────────────────────────────────────

describe('isCwdPlaceholder', () => {
  it.each([['.'], ['auto'], ['cwd'], [''], ['  '], [' . ']])(
    'treats %j as a placeholder',
    (value) => {
      expect(isCwdPlaceholder(value)).toBe(true)
    },
  )

  it.each([['./'], ['/srv/x'], ['~/x'], ['src']])(
    'does NOT treat %j as a gateway placeholder',
    (value) => {
      expect(isCwdPlaceholder(value)).toBe(false)
    },
  )
})

describe('isUnusableContainerCwd', () => {
  it.each([['/home/me/app'], ['/Users/me/app'], ['src'], ['.'], ['C:\\Users\\me']])(
    'rejects %j as a container workdir',
    (value) => {
      expect(isUnusableContainerCwd(value)).toBe(true)
    },
  )

  it.each([['/workspace'], ['/root'], ['/opt/app']])(
    'accepts %j as a container workdir',
    (value) => {
      expect(isUnusableContainerCwd(value)).toBe(false)
    },
  )
})

describe('readTerminalConfig', () => {
  it('reports absence when there is no terminal block', () => {
    expect(readTerminalConfig({}).present).toBe(false)
    expect(readTerminalConfig(null).present).toBe(false)
    expect(readTerminalConfig({ terminal: 'nonsense' }).present).toBe(false)
  })

  it('reads the documented keys', () => {
    const config = readTerminalConfig({
      terminal: {
        cwd: '/srv/x',
        backend: 'Docker',
        docker_mount_cwd_to_workspace: true,
        persistent_shell: true,
      },
    })
    expect(config).toEqual({
      present: true,
      cwd: '/srv/x',
      backend: 'docker',
      dockerMountCwdToWorkspace: true,
      persistentShell: true,
    })
  })

  it('accepts the legacy env_type key with backend taking precedence', () => {
    expect(readTerminalConfig({ terminal: { env_type: 'ssh' } }).backend).toBe('ssh')
    expect(
      readTerminalConfig({ terminal: { env_type: 'ssh', backend: 'docker' } })
        .backend,
    ).toBe('docker')
  })
})

describe('validateAgentCwd', () => {
  it('rejects every sentinel by name', () => {
    for (const value of ['.', './', 'auto', 'cwd']) {
      expect(() => validateAgentCwd(value, HOME)).toThrow(/sentinel/)
    }
  })

  it('rejects a relative path', () => {
    expect(() => validateAgentCwd('src/app', HOME)).toThrow(/relative path/)
  })

  it('rejects an empty value', () => {
    expect(() => validateAgentCwd('   ', HOME)).toThrow(/required/)
  })

  it('rejects a path that does not exist', () => {
    expect(() => validateAgentCwd('/definitely/not/here/xyz', HOME)).toThrow(
      /not an existing directory/,
    )
  })

  it('accepts an existing absolute directory', () => {
    expect(validateAgentCwd('/tmp')).toBe('/tmp')
  })
})
