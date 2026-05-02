import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useConfigureMcpServer,
  useDeleteMcpServer,
  useTestMcpServer,
} from '../hooks/use-mcp-mutations'
import { useMcpOauth } from '../hooks/use-mcp-oauth'
import { McpLogsDrawer } from './mcp-logs-drawer'
import type { McpServer, McpTestResult } from '@/types/mcp'

interface Props {
  server: McpServer
  onEdit: (server: McpServer) => void
}

const STATUS_COLORS: Record<McpServer['status'], string> = {
  connected: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-700',
}

export function McpServerCard({ server, onEdit }: Props) {
  const test = useTestMcpServer()
  const configure = useConfigureMcpServer()
  const remove = useDeleteMcpServer()
  const oauth = useMcpOauth()
  const qc = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <div className="rounded-xl border border-primary-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-primary-900">{server.name}</h3>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[server.status]}`}>
              {server.status}
            </span>
            <span className="rounded border border-primary-200 px-2 py-0.5 text-xs text-primary-600">
              {server.transportType}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-primary-500">
            {server.transportType === 'http' ? server.url : server.command}
          </p>
          {server.lastError ? (
            <p className="mt-2 text-xs text-red-600">{server.lastError}</p>
          ) : null}
          <p className="mt-2 text-xs text-primary-500">
            {server.discoveredToolsCount} tools · auth: {server.authType}
            {server.hasBearerToken ? ' · bearer set' : ''}
            {server.hasOAuthClientSecret ? ' · oauth secret set' : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="flex items-center gap-1 text-xs text-primary-600">
            <input
              type="checkbox"
              checked={server.enabled}
              disabled={configure.isPending}
              onChange={(e) =>
                configure.mutate({ name: server.name, enabled: e.target.checked })
              }
            />
            enabled
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-primary-300 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
          disabled={test.isPending}
          onClick={async () => {
            const result = await test.mutateAsync({ name: server.name })
            setTestResult(result)
          }}
        >
          {test.isPending ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="rounded border border-primary-300 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
          disabled={test.isPending}
          onClick={async () => {
            const result = await test.mutateAsync({ name: server.name })
            setTestResult(result)
            // Re-fetch the list so the card's discoveredToolsCount reflects
            // whatever the agent reports after this re-test.
            qc.invalidateQueries({ queryKey: ['mcp', 'servers'] })
          }}
        >
          {test.isPending ? 'Refreshing…' : 'Refresh'}
        </button>
        {server.authType === 'oauth' ? (
          <button
            type="button"
            className="rounded border border-primary-300 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
            disabled={oauth.isPending}
            onClick={() => {
              void oauth.start(server)
            }}
          >
            {oauth.isPending ? 'Waiting for reauth…' : 'Reauth'}
          </button>
        ) : null}
        <button
          type="button"
          className="rounded border border-primary-300 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
          onClick={() => setLogsOpen(true)}
        >
          Logs
        </button>
        <button
          type="button"
          className="rounded border border-primary-300 px-3 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
          onClick={() => onEdit(server)}
        >
          Edit
        </button>
        {confirmDelete ? (
          <>
            <button
              type="button"
              className="rounded border border-red-300 bg-red-50 px-3 py-1 text-xs font-medium text-red-700"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ name: server.name })}
            >
              Confirm Delete
            </button>
            <button
              type="button"
              className="rounded px-3 py-1 text-xs text-primary-600"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
      {testResult ? (
        <p className="mt-2 text-xs text-primary-600">
          {testResult.ok
            ? `Connected (${testResult.latencyMs ?? '?'}ms, ${testResult.discoveredTools.length} tools)`
            : `Failed: ${testResult.error || 'unknown error'}`}
        </p>
      ) : null}
      {oauth.isError && oauth.error ? (
        <p className="mt-2 text-xs text-red-600">Reauth failed: {oauth.error.message}</p>
      ) : null}
      {oauth.data?.status === 'connected' ? (
        <p className="mt-2 text-xs text-green-700">Reauth succeeded.</p>
      ) : null}
      <McpLogsDrawer
        server={logsOpen ? server : null}
        open={logsOpen}
        onClose={() => setLogsOpen(false)}
      />
    </div>
  )
}
