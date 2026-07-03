import { useEffect, useState } from 'react'
import {
  useDiscoverMcpTools,
  useUpsertMcpServer,
} from '../hooks/use-mcp-mutations'
import { useMcpCapabilityMode } from '../hooks/use-mcp-capability-mode'
import type { McpClientInput, McpServer } from '@/types/mcp'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/components/ui/scroll-area'

interface Props {
  open: boolean
  initial?: McpServer | McpClientInput | null
  onClose: () => void
}

const EMPTY: McpClientInput = {
  name: '',
  transportType: 'http',
  url: '',
  args: [],
  env: {},
  headers: {},
  authType: 'none',
  toolMode: 'all',
}

const FIELD =
  'h-10 w-full rounded-md border border-[#355244] bg-[#08110c] px-3 font-mono text-[14px] text-[#d4f5e4] outline-none transition-colors placeholder:text-[#3a5a4a] focus:border-[#00ff41] focus:shadow-[0_0_0_1px_rgba(0,255,65,0.18),0_0_18px_rgba(0,255,65,0.08)]'

const LABEL = 'flex flex-col gap-1.5 text-[11px] uppercase tracking-[0.22em] text-[#6a9a7a] font-mono'

function fromServer(server: McpServer): McpClientInput {
  return {
    name: server.name,
    transportType: server.transportType,
    url: server.url,
    command: server.command,
    args: server.args,
    env: {},
    headers: {},
    authType: server.authType,
    toolMode: server.toolMode,
    includeTools: server.includeTools,
    excludeTools: server.excludeTools,
  }
}

function isMcpServer(value: unknown): value is McpServer {
  return Boolean(value && typeof value === 'object' && 'discoveredToolsCount' in (value))
}

export function McpServerDialog({ open, initial, onClose }: Props) {
  const upsert = useUpsertMcpServer()
  const discover = useDiscoverMcpTools()
  const { mode: capabilityMode } = useMcpCapabilityMode()
  const [draft, setDraft] = useState<McpClientInput>(EMPTY)
  // Ephemeral, never persisted to a named exported type — secrets stay
  // in component-local state and are merged into the POST payload only at
  // submit time. The plain `string` typing avoids any cross-module shape
  // that the browser bundle could index for secret-bearing fields.
  const [bearerToken, setBearerToken] = useState('')
  // Tracks whether the server being edited already has a bearer token
  // configured server-side. The raw token is never sent to the browser
  // (masked by `maskSecretsInPlace`); we only know if one exists. Use this
  // to render a "currently set — leave blank to keep, type to replace"
  // hint instead of an empty password field that misleads the user.
  const [initialHasBearer, setInitialHasBearer] = useState(false)
  // When the existing bearer/oauth token is an env-reference like ${VAR_NAME},
  // show a diagnostic so the user knows it's resolved from the environment.
  const [authEnvRef, setAuthEnvRef] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBearerToken('')
    if (!initial) {
      setDraft(EMPTY)
      setInitialHasBearer(false)
      setAuthEnvRef(null)
    } else if (isMcpServer(initial)) {
      setDraft(fromServer(initial))
      setInitialHasBearer(Boolean(initial.hasBearerToken))
      setAuthEnvRef(initial.authEnvRef ?? null)
    } else {
      setDraft(initial)
      setInitialHasBearer(false)
      setAuthEnvRef(null)
    }
  }, [open, initial])

  const update = (patch: Partial<McpClientInput>) =>
    setDraft((prev) => ({ ...prev, ...patch }))

  const fallbackMode = capabilityMode === 'fallback'
  const editingSavedServer = isMcpServer(initial)
  const discoverDisabled = discover.isPending || !draft.name || (fallbackMode && !editingSavedServer)
  const discoverDisabledReason = fallbackMode && !editingSavedServer
    ? 'Fallback mode can only discover tools for an already-saved server. Save first, then reopen Edit.'
    : ''

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="w-[min(760px,95vw)] overflow-hidden border border-[#355244] bg-[#060b10]/96 p-0 text-[#d4f5e4] shadow-[0_0_0_1px_rgba(0,255,65,0.08),0_24px_80px_rgba(0,0,0,0.55),0_0_40px_rgba(0,255,65,0.08)] backdrop-blur-xl">
        <div className="flex max-h-[85vh] flex-col bg-[radial-gradient(circle_at_top,rgba(0,255,65,0.08),transparent_38%),linear-gradient(180deg,rgba(4,12,8,0.96),rgba(3,8,6,0.98))]">
          <div className="border-b border-[#1a2a22] px-5 py-4">
            <DialogTitle className="text-balance font-mono text-[28px] font-semibold tracking-[0.04em] text-[#d4f5e4]">
              🔌 {draft.name || (initial ? 'Edit MCP Server' : 'Add MCP Server')}
            </DialogTitle>
            <DialogDescription className="mt-1 font-mono text-[12px] uppercase tracking-[0.14em] text-[#6a9a7a]">
              {initial ? 'Edit MCP Server' : 'Add MCP Server'} •{' '}
              {draft.transportType.toUpperCase()} transport •{' '}
              {draft.authType || 'none'} auth
            </DialogDescription>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-md border border-[#355244] bg-[#0c1510] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#d4f5e4]">
                {draft.transportType}
              </span>
              <span className="rounded-md border border-[#355244] bg-[#0c1510] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#d4f5e4]">
                auth: {draft.authType || 'none'}
              </span>
              {fallbackMode ? (
                <span className="rounded-md border border-[#b56a1f] bg-[#22160a] px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#ffd17a]">
                  config-only mode
                </span>
              ) : null}
            </div>
          </div>

          <ScrollAreaRoot className="h-[56vh]">
            <ScrollAreaViewport className="px-5 py-4">
              <div className="space-y-4">
                <label className={LABEL}>
                  <span>Name</span>
                  <input
                    className={FIELD}
                    value={draft.name}
                    onChange={(e) => update({ name: e.target.value })}
                    placeholder="my-mcp-server"
                  />
                </label>
                <label className={LABEL}>
                  <span>Transport</span>
                  <select
                    className={FIELD}
                    value={draft.transportType}
                    onChange={(e) =>
                      update({
                        transportType: e.target.value as 'http' | 'stdio',
                      })
                    }
                  >
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                  </select>
                </label>
                {draft.transportType === 'http' ? (
                  <label className={LABEL}>
                    <span>URL</span>
                    <input
                      className={FIELD}
                      value={draft.url || ''}
                      onChange={(e) => update({ url: e.target.value })}
                      placeholder="https://example.com/mcp"
                    />
                  </label>
                ) : (
                  <>
                    <label className={LABEL}>
                      <span>Command</span>
                      <input
                        className={FIELD}
                        value={draft.command || ''}
                        onChange={(e) => update({ command: e.target.value })}
                        placeholder="/usr/local/bin/my-mcp"
                      />
                    </label>
                    <label className={LABEL}>
                      <span>Args (one per line)</span>
                      <textarea
                        className={`${FIELD} h-auto min-h-24 py-2 text-xs`}
                        rows={3}
                        value={(draft.args || []).join('\n')}
                        onChange={(e) =>
                          update({
                            args: e.target.value
                              .split('\n')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                <label className={LABEL}>
                  <span>Auth</span>
                  <select
                    className={FIELD}
                    value={draft.authType || 'none'}
                    onChange={(e) =>
                      update({
                        authType: e.target.value as 'none' | 'bearer' | 'oauth',
                      })
                    }
                  >
                    <option value="none">none</option>
                    <option value="bearer">bearer</option>
                    <option value="oauth">oauth</option>
                  </select>
                </label>
                {draft.authType === 'bearer' ? (
                  <label className={LABEL}>
                    <span>Bearer token</span>
                    <input
                      type="password"
                      className={FIELD}
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                      autoComplete="off"
                      placeholder={
                        initialHasBearer
                          ? '••••••• (currently set — leave blank to keep, type to replace)'
                          : 'Enter bearer token'
                      }
                    />
                    {authEnvRef ? (
                      <span className="text-[11px] text-[#ffd17a]">
                        Token resolved from env var <code className="font-mono">{authEnvRef}</code> — leave blank to keep current, or type to override.
                      </span>
                    ) : initialHasBearer ? (
                      <span className="text-[11px] text-[#8cffad]">
                        Token currently set on server. Leave blank to keep
                        existing; type a new value to replace.
                      </span>
                    ) : null}
                  </label>
                ) : null}

                {fallbackMode ? (
                  <p className="rounded-md border border-[#b56a1f] bg-[#22160a] px-3 py-2 font-mono text-[12px] text-[#ffd17a]">
                    ⚠ Local fallback mode — config-only CRUD. Discover works for saved servers; unsaved drafts must be saved first.
                  </p>
                ) : null}
                {discover.data ? (
                  <p className="rounded-md border border-[#1a2a22] bg-[#08110c] px-3 py-2 font-mono text-[12px] text-[#8cffad]">
                    Discovered {discover.data.tools.length} tools.
                  </p>
                ) : null}
                {discover.error ? (
                  <p className="rounded-md border border-[#5a2228] bg-[#18090b] px-3 py-2 font-mono text-[12px] text-[#ff8a96]">
                    {discover.error.message}
                  </p>
                ) : null}
                {upsert.error ? (
                  <p className="rounded-md border border-[#5a2228] bg-[#18090b] px-3 py-2 font-mono text-[12px] text-[#ff8a96]">
                    {upsert.error.message}
                  </p>
                ) : null}
              </div>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar orientation="vertical">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollAreaRoot>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1a2a22] bg-[#050a0e]/80 px-5 py-3">
            <p className="min-w-0 flex-1 truncate font-mono text-[12px] uppercase tracking-[0.12em] text-[#6a9a7a]">
              Target:{' '}
              <code className="inline-code text-[#d4f5e4]">
                {draft.transportType === 'http'
                  ? draft.url || '—'
                  : draft.command || '—'}
              </code>
            </p>
            <div className="flex items-center gap-2">
            <Button
              className="border border-transparent bg-transparent font-mono text-[#a0d4b8] hover:border-[#1a2a22] hover:bg-[#0f1a14] hover:text-[#00ff41]"
              size="sm"
              onClick={onClose}
              disabled={upsert.isPending}
            >
              Cancel
            </Button>
            <Button
              className="border border-[#1a2a22] bg-[#0b120d] font-mono text-[#a0d4b8] hover:border-[#355244] hover:bg-[#0f1a14] hover:text-[#00ff41] disabled:border-[#1a2a22] disabled:bg-[#070c09] disabled:text-[#3a5a4a]"
              size="sm"
              disabled={discoverDisabled}
              title={discoverDisabledReason}
              onClick={() => discover.mutate(editingSavedServer ? { name: draft.name, transportType: draft.transportType } : draft)}
            >
              {discover.isPending ? 'Discovering…' : 'Discover'}
            </Button>
            <Button
              className="border border-[#0f5f28] bg-[#0b180f] font-mono text-[#d4f5e4] hover:border-[#00ff41] hover:bg-[#102114] hover:text-[#00ff41] disabled:border-[#1a2a22] disabled:bg-[#070c09] disabled:text-[#3a5a4a]"
              size="sm"
              disabled={upsert.isPending || !draft.name}
              onClick={async () => {
                const payload = bearerToken
                  ? { ...draft, bearerToken }
                  : draft
                try {
                  await upsert.mutateAsync(payload)
                  onClose()
                } finally {
                  // Wipe ephemeral secret on success and on error so it
                  // does not linger if the user retries the dialog.
                  setBearerToken('')
                }
              }}
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
