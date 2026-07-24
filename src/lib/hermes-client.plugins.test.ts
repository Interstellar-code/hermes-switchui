import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  deleteAgentPlugin,
  getPluginsHub,
  installAgentPlugin,
  projectPluginsHub,
  rescanDashboardPlugins,
} from './hermes-client'

const hubFixture = {
  plugins: [
    {
      name: 'safe-plugin',
      version: '1.2.3',
      description: 'Safe description',
      source: 'git',
      runtime_status: 'disabled',
      has_dashboard_manifest: true,
      dashboard_manifest: {
        label: 'Safe tab',
        has_api: true,
        tab: { path: '/safe-plugin', hidden: true },
        entry: 'dist/private.js',
        css: 'dist/private.css',
        slots: ['header'],
        api: '/api/private',
      },
      path: '/Users/me/.hermes/plugins/safe-plugin',
      can_remove: true,
      can_update_git: true,
      auth_required: true,
      auth_command: 'hermes auth safe-plugin',
      user_hidden: true,
    },
  ],
  orphan_dashboard_plugins: [{ path: '/should/not/reach/the-ui' }],
  providers: { memory_provider: 'not-a-plugins-page-control' },
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Plugins Hub client helpers', () => {
  it('projects Hub rows to the small UI-safe contract', () => {
    const hub = projectPluginsHub(hubFixture)

    expect(hub).toEqual({
      plugins: [
        {
          name: 'safe-plugin',
          version: '1.2.3',
          description: 'Safe description',
          source: 'git',
          runtimeStatus: 'disabled',
          hasDashboardManifest: true,
          dashboardManifest: {
            label: 'Safe tab',
            hasApi: true,
            hasTab: true,
            tabHidden: true,
          },
          canRemove: true,
          canUpdateGit: true,
          authRequired: true,
          authCommand: 'hermes auth safe-plugin',
          userHidden: true,
        },
      ],
    })
    expect(JSON.stringify(hub)).not.toMatch(
      /Users\/me|private\.js|private\.css|\/api\/private|providers|orphan/i,
    )
  })

  it('uses the authenticated proxy and Hub endpoint', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(hubFixture))

    await expect(getPluginsHub()).resolves.toEqual(
      projectPluginsHub(hubFixture),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/dashboard/plugins/hub',
      undefined,
    )
  })

  it('treats a stale dashboard HTML fallback as endpoint-unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<!doctype html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    )

    await expect(getPluginsHub()).rejects.toThrow(/endpoint-unavailable/)
  })

  it('keeps an upstream Hub error available to the query error state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream unavailable', { status: 503 }),
    )

    await expect(getPluginsHub()).rejects.toThrow(/503 upstream unavailable/)
  })

  it('rescans through the authenticated dashboard proxy', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ ok: true, count: 4 }))

    await expect(rescanDashboardPlugins()).resolves.toEqual({
      ok: true,
      count: 4,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/dashboard/plugins/rescan',
      undefined,
    )
  })

  it('always installs without force or dashboard activation', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ ok: true }))

    await installAgentPlugin({ identifier: 'owner/plugin' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/dashboard/agent-plugins/install',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'owner/plugin',
          force: false,
          enable: false,
        }),
      }),
    )
  })

  it('uses the JSON-content-type proxy contract for delete', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))

    await deleteAgentPlugin('owner/plugin')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard-proxy/api/dashboard/agent-plugins/owner%2Fplugin',
      expect.objectContaining({
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})
