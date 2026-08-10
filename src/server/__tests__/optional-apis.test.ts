import { describe, expect, it } from 'vitest'
import { OPTIONAL_APIS } from '../gateway-capabilities'

/**
 * Regression guard for the "Missing Hermes APIs detected" warning.
 *
 * That warning is emitted for any capability NOT in OPTIONAL_APIS, and it
 * tells the user to install Hermes Agent and start the gateway and dashboard.
 * On a healthy install missing only an optional plugin, every one of those
 * instructions is already satisfied — so the message sends someone to debug a
 * working system. `conductor` was absent from the set, which is exactly how
 * that happened in the field.
 *
 * The rule: a capability belongs here when its screen degrades to a
 * placeholder instead of failing, and nowhere else.
 */
describe('OPTIONAL_APIS', () => {
  it.each([
    // Renders an "upstream not ready" placeholder — see the `conductor` field's
    // doc comment and #262. Its omission caused the false warning.
    'conductor',
    // Task board degrades when the Agent Kanban plugin is absent.
    'kanban',
    // Projects screen degrades when the Projects plugin is absent.
    'projects',
    // Primary `mcp` probe covers the feature; the fallback path is a bonus.
    'mcpFallback',
  ])('treats %s as optional, so its absence raises no upgrade warning', (key) => {
    expect(OPTIONAL_APIS.has(key)).toBe(true)
  })

  it.each([
    // Without these the app cannot hold a conversation at all, which is a
    // genuinely broken backend and worth telling the user to go fix.
    'models',
    'sessions',
    'skills',
    'config',
  ])('keeps %s critical, so a real gap is still reported', (key) => {
    expect(OPTIONAL_APIS.has(key)).toBe(false)
  })
})
