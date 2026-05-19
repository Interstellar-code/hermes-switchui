/**
 * Browser-side SSE consumer for the workflow-engine plugin event stream.
 *
 * Usage (React component or hook):
 *   const es = subscribePluginEvents(runId, (event) => { ... });
 *   return () => es.close();
 *
 * Server-side SSE is handled inline in plugin-client.ts via ReadableStream.
 */
import type { RunEvent } from '../interface.js';

const PLUGIN_SSE_PATH = '/api/dashboard-proxy/api/plugins/workflow-engine/events';

export interface PluginSseOptions {
  runId?: string;
  onEvent: (event: RunEvent) => void;
  onError?: (err: Event) => void;
}

/**
 * Opens an EventSource to the plugin SSE endpoint.
 * Returns the EventSource so the caller can .close() it.
 */
export function subscribePluginEvents(opts: PluginSseOptions): EventSource {
  const url = new URL(PLUGIN_SSE_PATH, window.location.origin);
  if (opts.runId) {
    url.searchParams.set('runId', opts.runId);
  }

  const es = new EventSource(url.toString());

  es.addEventListener('message', (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data as string) as RunEvent;
      opts.onEvent(event);
    } catch {
      // skip malformed frame
    }
  });

  // Named event types emitted by the plugin (e.g. 'workflow_started', 'node_completed')
  const knownTypes = [
    'workflow_started',
    'workflow_completed',
    'workflow_failed',
    'workflow_cancelled',
    'workflow_resumed',
    'node_started',
    'node_completed',
    'node_failed',
    'approval_required',
    'approval_received',
    'phase_transition',
    'ping',
  ];

  for (const type of knownTypes) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as RunEvent;
        opts.onEvent(event);
      } catch {
        // skip
      }
    });
  }

  if (opts.onError) {
    es.addEventListener('error', opts.onError);
  }

  return es;
}
