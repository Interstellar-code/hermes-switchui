import { describe, expect, it, vi } from 'vitest'

// listProfileSessions() drives the ?profile= route branch in sessions.ts.
// A schema-drifted profile DB (e.g. hermes-agent's /api/profiles/sessions
// hitting "no such column") must never collapse to a silent empty list —
// it has to surface via the `errors` array. Mock at the dashboardFetch
// boundary so we exercise the real dashboardJson()/listProfileSessions()
// parsing, not just the type shape.
const dashboardFetch = vi.fn()
vi.mock('./gateway-capabilities', () => ({
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
  dashboardFetch: (...args: Array<unknown>) => dashboardFetch(...args),
}))

describe('listProfileSessions degraded-profile signal', () => {
  it('surfaces a schema-drifted profile via `errors`, not as a silent zero', async () => {
    // Exact shape confirmed via live probe (see memory obs 34100): sessions
    // is empty, but `errors` names the profile and the underlying DB error.
    dashboardFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessions: [],
          total: 0,
          profile_totals: {},
          limit: 3,
          offset: 0,
          errors: [{ profile: 'neo', error: 'no such column: s.display_name' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { listProfileSessions } = await import('./claude-dashboard-api')
    const result = await listProfileSessions('neo')

    expect(result.sessions).toEqual([])
    // The load-bearing assertion: an empty `sessions` array alone is
    // ambiguous (could mean "genuinely empty profile"). `errors` is what
    // distinguishes "degraded" from "empty" — a caller checking only
    // `sessions.length === 0` would render this as a silent zero.
    expect(result.errors).toEqual([{ profile: 'neo', error: 'no such column: s.display_name' }])
    expect(result.errors?.length).toBeGreaterThan(0)
  })

  it('a genuinely empty (non-degraded) profile has no `errors` entries', async () => {
    dashboardFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessions: [],
          total: 0,
          profile_totals: { default: 0 },
          limit: 50,
          offset: 0,
          errors: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const { listProfileSessions } = await import('./claude-dashboard-api')
    const result = await listProfileSessions('default')

    expect(result.sessions).toEqual([])
    expect(result.errors).toEqual([])
  })
})
