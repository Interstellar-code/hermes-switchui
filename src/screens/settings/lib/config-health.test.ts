import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  checkConfigHealth,
  requiredValueMatches,
} from './config-health'
import { getPresets, listKeyMeta } from './key-meta'
import type { HealthFinding } from './config-health'
import type { KeyMeta, Preset } from './key-meta-types'

const META = listKeyMeta()

function draftKeyFor(m: KeyMeta): string {
  return m.scope === 'hermes-config' ? `config.${m.id}` : m.id
}

/**
 * Draft with every required key at its locked value and every rule quiet —
 * the baseline the per-rule tests mutate. Required keys come from the real
 * data (8 today); the rest pin the values the 9 research rules read.
 */
function cleanDraft(): Record<string, unknown> {
  const draft: Record<string, unknown> = {}
  for (const m of META) {
    if (m.required) draft[draftKeyFor(m)] = m.required.value
  }
  draft['config.approvals.mode'] = 'smart'
  draft['config.approvals.timeout'] = 300
  draft['config.sessions.auto_prune'] = true
  draft['config.checkpoints.auto_prune'] = true
  draft['config.model_catalog.enabled'] = true
  draft['config.agent.api_max_retries'] = 3
  draft['config.agent.clarify_timeout'] = 1800
  draft['config.compression.hygiene_hard_message_limit'] = 5000
  draft['config.updates.pre_update_backup'] = 'quick'
  return draft
}

/** Findings with the given rule id, ignoring unrelated rules. */
function findingsFor(
  draft: Record<string, unknown>,
  id: string,
): Array<HealthFinding> {
  return checkConfigHealth(draft, META).filter((f) => f.id === id)
}

/** Exactly one finding with the id, returning it. */
function oneFinding(draft: Record<string, unknown>, id: string): HealthFinding {
  const found = findingsFor(draft, id)
  expect(found.length).toBe(1)
  return found[0]
}

describe('checkConfigHealth', () => {
  it('returns no findings for a clean draft', () => {
    expect(checkConfigHealth(cleanDraft(), META)).toEqual([])
  })

  // ── research §4 issue 1 ──────────────────────────────────────────────────

  it('issue 1: manual approvals with a short timeout', () => {
    const draft = {
      ...cleanDraft(),
      'config.approvals.mode': 'manual',
      'config.approvals.timeout': 60,
    }
    const finding = oneFinding(draft, 'approvals-manual-short-timeout')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({
      'config.approvals.mode': 'smart',
      'config.approvals.timeout': 300,
    })
  })

  it('issue 1: manual mode alone (timeout at floor) stays quiet', () => {
    const draft = { ...cleanDraft(), 'config.approvals.mode': 'manual' }
    expect(findingsFor(draft, 'approvals-manual-short-timeout')).toEqual([])
  })

  // ── issue 2 ──────────────────────────────────────────────────────────────

  it('issue 2: sessions auto-prune off', () => {
    const draft = { ...cleanDraft(), 'config.sessions.auto_prune': false }
    const finding = oneFinding(draft, 'sessions-auto-prune-off')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({ 'config.sessions.auto_prune': true })
  })

  it('issue 2: checkpoints auto-prune off', () => {
    const draft = { ...cleanDraft(), 'config.checkpoints.auto_prune': false }
    const finding = oneFinding(draft, 'checkpoints-auto-prune-off')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({ 'config.checkpoints.auto_prune': true })
  })

  // ── issue 3 ──────────────────────────────────────────────────────────────

  it('issue 3: model catalog disabled', () => {
    const draft = { ...cleanDraft(), 'config.model_catalog.enabled': false }
    const finding = oneFinding(draft, 'model-catalog-disabled')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({ 'config.model_catalog.enabled': true })
  })

  // ── issue 4 ──────────────────────────────────────────────────────────────

  it('issue 4: api_max_retries below 3', () => {
    const draft = { ...cleanDraft(), 'config.agent.api_max_retries': 1 }
    const finding = oneFinding(draft, 'api-max-retries-low')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({ 'config.agent.api_max_retries': 3 })
  })

  // ── issue 5 (brief extras) ───────────────────────────────────────────────

  it('issue 5: legacy top-level fallback_model (string) while fallback_providers is set', () => {
    const draft = {
      ...cleanDraft(),
      'config.fallback_model': 'claude-sonnet',
      'config.fallback_providers': ['manifest'],
    }
    const finding = oneFinding(draft, 'legacy-fallback-model')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({})
    expect(finding.message).toContain('appended')
    expect(findingsFor(draft, 'legacy-flat-api-server-keys')).toEqual([])
  })

  it('issue 5: legacy fallback_model as a dict or chain list is also "set"', () => {
    for (const legacy of [
      { provider: 'manifest', model: 'm1' }, // dict shape (_validate_fallback_model)
      ['anthropic', 'openrouter'], // chain-list shape
    ]) {
      const draft = {
        ...cleanDraft(),
        'config.fallback_model': legacy,
        'config.fallback_providers': ['manifest'],
      }
      expect(oneFinding(draft, 'legacy-fallback-model').severity).toBe('warn')
    }
  })

  it('issue 5: an empty legacy fallback_model (blank string or empty dict) stays quiet', () => {
    for (const legacy of ['', {}]) {
      const draft = {
        ...cleanDraft(),
        'config.fallback_model': legacy,
        'config.fallback_providers': ['manifest'],
      }
      expect(findingsFor(draft, 'legacy-fallback-model')).toEqual([])
    }
  })

  it('issue 5: legacy fallback_model alone (no providers list) is not dead-pair noise', () => {
    const draft = {
      ...cleanDraft(),
      'config.fallback_model': 'claude-sonnet',
    }
    expect(findingsFor(draft, 'legacy-fallback-model')).toEqual([])
  })

  it('issue 5: flat api_server host/port alongside extra.* (both pairs)', () => {
    const hostDraft = {
      ...cleanDraft(),
      'config.platforms.api_server.host': '0.0.0.0',
    }
    const hostFinding = oneFinding(hostDraft, 'legacy-flat-api-server-keys')
    expect(hostFinding.severity).toBe('warn')
    expect(hostFinding.fix).toEqual({})

    const portDraft = {
      ...cleanDraft(),
      'config.platforms.api_server.port': 9999,
    }
    expect(oneFinding(portDraft, 'legacy-flat-api-server-keys').severity).toBe(
      'warn',
    )
  })

  it('issue 5: flat keys without extra.* twins stay quiet', () => {
    // cleanDraft carries extra.host/extra.port (required); remove the twins
    // so the flat key is the only copy — nothing dead to report.
    const draft = cleanDraft()
    delete draft['config.platforms.api_server.extra.host']
    draft['config.platforms.api_server.host'] = '0.0.0.0'
    expect(findingsFor(draft, 'legacy-flat-api-server-keys')).toEqual([])
    // …and the removed required key is "not readable here", not drift.
    expect(
      findingsFor(draft, 'required-platforms.api_server.extra.host'),
    ).toEqual([])
  })

  // ── issue 6 ──────────────────────────────────────────────────────────────

  it('issue 6: cdp_url pinned to a devtools/browser/<uuid> endpoint', () => {
    const draft = {
      ...cleanDraft(),
      'config.browser.cdp_url':
        'http://127.0.0.1:9222/devtools/browser/6c1f...',
    }
    const finding = oneFinding(draft, 'browser-cdp-url-pinned')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({})
  })

  it('issue 6: a stable cdp_url endpoint stays quiet', () => {
    const draft = {
      ...cleanDraft(),
      'config.browser.cdp_url': 'http://127.0.0.1:9222',
    }
    expect(findingsFor(draft, 'browser-cdp-url-pinned')).toEqual([])
  })

  // ── issue 7 ──────────────────────────────────────────────────────────────

  it('issue 7: pre-update backup off (legacy false and enum off)', () => {
    for (const value of [false, 'off'] as const) {
      const draft = {
        ...cleanDraft(),
        'config.updates.pre_update_backup': value,
      }
      const finding = oneFinding(draft, 'pre-update-backup-off')
      expect(finding.severity).toBe('warn')
      expect(finding.fix).toEqual({
        'config.updates.pre_update_backup': 'quick',
      })
    }
  })

  // ── issue 8 ──────────────────────────────────────────────────────────────

  it('issue 8: clarify timeout below floor while interactive clarify is on', () => {
    const draft = { ...cleanDraft(), 'config.agent.clarify_timeout': 600 }
    const finding = oneFinding(draft, 'clarify-timeout-low')
    expect(finding.severity).toBe('warn')
    expect(finding.fix).toEqual({ 'config.agent.clarify_timeout': 1800 })
  })

  it('issue 8: a low clarify timeout is fine when interactive clarify is off', () => {
    const draft = cleanDraft()
    draft['config.agent.clarify_timeout'] = 600
    draft['config.api_server.interactive_clarify'] = false
    expect(findingsFor(draft, 'clarify-timeout-low')).toEqual([])
    // (flipping the required key surfaces its own required-rule, not this one)
  })

  // ── issue 9 ──────────────────────────────────────────────────────────────

  it('issue 9: hygiene tuned below default, outside recommended/preset values, is informational, no auto-fix', () => {
    const draft = {
      ...cleanDraft(),
      'config.compression.hygiene_hard_message_limit': 200,
    }
    const finding = oneFinding(draft, 'hygiene-limit-tuned')
    expect(finding.severity).toBe('info')
    expect(finding.fix).toEqual({})
    expect(finding.message).toContain('5000')
  })

  it('issue 9: quiet at the meta recommended value and at every shipped preset value', () => {
    // 400 = meta recommended (and balanced), 800 = power, 300 = safe —
    // intended tuning by definition, same reasoning as the clarify floor.
    for (const quiet of [400, 800, 300]) {
      const draft = {
        ...cleanDraft(),
        'config.compression.hygiene_hard_message_limit': quiet,
      }
      expect(findingsFor(draft, 'hygiene-limit-tuned')).toEqual([])
    }
  })

  // ── required keys (brief extra) ──────────────────────────────────────────

  it('required: a drifted value is an error with the locked value as fix', () => {
    const draft = { ...cleanDraft(), 'config.model.provider': 'custom' }
    const finding = oneFinding(draft, 'required-model.provider')
    expect(finding.severity).toBe('error')
    expect(finding.fix).toEqual({ 'config.model.provider': 'manifest' })
  })

  it('required: an absent required key is not readable here, not drift', () => {
    // `_normalize_config_for_web` drops e.g. the model dict down to
    // its default string, so absence means "not exposed by this API" —
    // fabricating a fix beside that string could clobber the real setting.
    const draft = cleanDraft()
    delete draft['config.platforms.api_server.extra.port']
    expect(
      findingsFor(draft, 'required-platforms.api_server.extra.port'),
    ).toEqual([])
  })

  it('required: a numeric string matches its numeric locked value (agent coerces on read)', () => {
    const draft = {
      ...cleanDraft(),
      'config.platforms.api_server.extra.port': '8642',
    }
    expect(
      findingsFor(draft, 'required-platforms.api_server.extra.port'),
    ).toEqual([])
  })

  it('required: a list superset or reordered list matches (order-free containment)', () => {
    const toolsets = (value: Array<string>) => ({
      ...cleanDraft(),
      'config.toolsets': value,
    })
    expect(
      findingsFor(
        toolsets(['web', 'hermes-cli', 'browser', 'kanban']),
        'required-toolsets',
      ),
    ).toEqual([])
    expect(
      findingsFor(toolsets(['kanban', 'hermes-cli']), 'required-toolsets'),
    ).toEqual([])
  })

  it('required: a list missing locked items fixes by appending only the missing items', () => {
    const draft = {
      ...cleanDraft(),
      'config.toolsets': ['hermes-cli', 'web'],
    }
    const finding = oneFinding(draft, 'required-toolsets')
    // The user's items survive, in their order; only `kanban` is added.
    expect(finding.fix).toEqual({
      'config.toolsets': ['hermes-cli', 'web', 'kanban'],
    })
  })

  it('required: clean draft surfaces no required-* findings', () => {
    expect(
      checkConfigHealth(cleanDraft(), META).filter((f) =>
        f.id.startsWith('required-'),
      ),
    ).toEqual([])
  })
})

describe('applyPreset', () => {
  it('over all 3 real presets: only preset keys, config.-prefixed, values verbatim', () => {
    const requiredDraftKeys = new Set(
      META.filter((m) => m.required).map(draftKeyFor),
    )
    for (const preset of getPresets()) {
      const patch = applyPreset(cleanDraft(), preset, META)
      const presetKeys = new Set(
        Object.keys(preset.values).map((k) => `config.${k}`),
      )
      // The patch is real (non-empty over this baseline) …
      expect(Object.keys(patch).length).toBeGreaterThan(0)
      for (const [key, value] of Object.entries(patch)) {
        // … every key belongs to the preset …
        expect(presetKeys.has(key)).toBe(true)
        expect(value).toEqual(preset.values[key.slice('config.'.length)])
        // … and no real preset patch ever carries a required key.
        expect(requiredDraftKeys.has(key)).toBe(false)
      }
    }
  })

  it('health: applying any shipped preset over the clean draft leaves no findings at all', () => {
    // Warn/error must not appear (research-trigger rules vs preset values),
    // and info must not either: preset-set tunings (hygiene 400/800/300) are
    // intended by definition, so the tuned-info rule stays quiet for them.
    for (const preset of getPresets()) {
      const applied = {
        ...cleanDraft(),
        ...applyPreset(cleanDraft(), preset, META),
      }
      expect(checkConfigHealth(applied, META)).toEqual([])
    }
  })

  it('never touches a required key, even when the preset lists one', () => {
    const hostile: Preset = {
      id: 'balanced',
      label: 'synthetic',
      values: {
        'model.provider': 'openai', // required: manifest
        toolsets: ['everything'], // required: locked list
        'agent.max_turns': 500, // fine
      },
    }
    const patch = applyPreset(cleanDraft(), hostile, META)
    expect(Object.keys(patch)).toEqual(['config.agent.max_turns'])
    expect(patch['config.agent.max_turns']).toBe(500)
  })

  it('never changes keys the preset does not list', () => {
    const draft = { ...cleanDraft(), 'config.agent.gateway_timeout': 123 }
    const patch = applyPreset(draft, getPresets()[0], META)
    expect(patch['config.agent.gateway_timeout']).toBeUndefined()
  })

  it('skips keys whose draft value already equals the preset value', () => {
    // cleanDraft pins approvals.timeout 300 and approvals.mode smart — the
    // balanced preset ships both, so they must not appear in the patch.
    const balanced = getPresets().find((p) => p.id === 'balanced')
    expect(balanced).toBeDefined()
    const patch = applyPreset(cleanDraft(), balanced as Preset, META)
    expect(patch['config.approvals.timeout']).toBeUndefined()
    expect(patch['config.approvals.mode']).toBeUndefined()
    // but a genuinely different value does appear
    expect(patch['config.agent.max_turns']).toBe(
      balanced?.values['agent.max_turns'],
    )
  })

  it('second application over an already-applied draft writes nothing', () => {
    const preset = getPresets()[0]
    const applied = {
      ...cleanDraft(),
      ...applyPreset(cleanDraft(), preset, META),
    }
    expect(applyPreset(applied, preset, META)).toEqual({})
  })
})

describe('requiredValueMatches', () => {
  // int meta with locked value 8642 — the profile string the agent coerces.
  const port = META.find((m) => m.id === 'platforms.api_server.extra.port')!
  // list meta locked to ["hermes-cli","kanban"].
  const toolsets = META.find((m) => m.id === 'toolsets')!

  it('compares int/float meta numerically when the value is a numeric string', () => {
    expect(requiredValueMatches(port, '8642')).toBe(true)
    expect(requiredValueMatches(port, 8642)).toBe(true)
    expect(requiredValueMatches(port, '8643')).toBe(false)
  })

  it('falls back to strict equality for non-numeric strings and other types', () => {
    expect(requiredValueMatches(port, 'auto')).toBe(false)
    expect(requiredValueMatches(port, '')).toBe(false)
    expect(requiredValueMatches(port, undefined)).toBe(false)
  })

  it('treats a list required value as order-free containment, not equality', () => {
    expect(requiredValueMatches(toolsets, ['kanban', 'hermes-cli'])).toBe(true)
    expect(
      requiredValueMatches(toolsets, ['hermes-cli', 'kanban', 'web']),
    ).toBe(true)
    expect(requiredValueMatches(toolsets, ['hermes-cli'])).toBe(false)
    expect(requiredValueMatches(toolsets, 'all')).toBe(false)
  })
})
