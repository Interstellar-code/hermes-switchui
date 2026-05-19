/**
 * ensurePluginInstalled — probes /api/dashboard/agent-plugins to check
 * whether the workflow-engine plugin is present and enabled.
 * If not enabled, sends the enable request automatically.
 *
 * Called on-mount by /workflows when backend=plugin.
 * Safe to call multiple times — idempotent.
 */

const PLUGIN_NAME = 'workflow-engine';

export type PluginStatus =
  | 'installed'   // enabled and running
  | 'disabled'    // present but disabled — will auto-enable
  | 'not_found'   // not installed
  | 'error';      // probe failed

export interface EnsureResult {
  status: PluginStatus;
  message?: string;
}

/**
 * Probe the dashboard for the workflow-engine plugin.
 * If disabled, automatically enables it.
 * Returns current status.
 */
export async function ensurePluginInstalled(): Promise<EnsureResult> {
  try {
    const res = await fetch('/api/dashboard-proxy/api/dashboard/agent-plugins');
    if (!res.ok) {
      return { status: 'error', message: `Probe failed: ${res.status}` };
    }

    const data = (await res.json()) as unknown;
    const plugins = Array.isArray(data)
      ? data
      : (data as Record<string, unknown>).plugins ?? [];

    if (!Array.isArray(plugins)) {
      return { status: 'error', message: 'Unexpected plugins response shape' };
    }

    const plugin = (plugins as Array<Record<string, unknown>>).find(
      (p) => p['name'] === PLUGIN_NAME || p['id'] === PLUGIN_NAME,
    );

    if (!plugin) {
      return { status: 'not_found', message: `Plugin '${PLUGIN_NAME}' not found` };
    }

    // If disabled, auto-enable
    if (plugin['enabled'] === false || plugin['status'] === 'disabled') {
      const enableRes = await fetch(
        `/api/dashboard-proxy/api/dashboard/agent-plugins/${encodeURIComponent(PLUGIN_NAME)}/enable`,
        { method: 'POST' },
      );
      if (!enableRes.ok) {
        return {
          status: 'disabled',
          message: `Found but enable failed: ${enableRes.status}`,
        };
      }
      return { status: 'installed', message: 'Auto-enabled' };
    }

    return { status: 'installed' };
  } catch (err: unknown) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
