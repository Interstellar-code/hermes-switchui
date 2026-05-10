'use client'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { writeTextToClipboard } from '@/lib/clipboard'
import { toast } from '@/components/ui/toast'
import { Ico, serverInitials } from './icons'
import type { McpServerView } from './mcp-screen'

export type { McpServerView }

type DrawerTab = 'overview' | 'tools' | 'config' | 'logs'

type McpDetailDrawerProps = {
  server: McpServerView | null
  onClose: () => void
  onToggle: (server: McpServerView) => void
}

/* ── component ── */
export function McpDetailDrawer({ server, onClose, onToggle }: McpDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && server) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [server, onClose])

  // Reset tab when server changes
  useEffect(() => {
    if (server) setActiveTab('overview')
  }, [server?.id])

  const toolEntries = useMemo(() => {
    if (!server) return []
    if (server.discoveredTools && server.discoveredTools.length > 0) {
      return server.discoveredTools.map((t) => ({ n: t.name, d: t.description || '(no description)' }))
    }
    return Array.from({ length: Math.min(server.tools, 4) }, (_, i) => ({
      n: `${server.id}.tool_${i + 1}`,
      d: '(no schema introspected — run Test to fetch)',
    }))
  }, [server])

  if (!server) {
    return (
      <>
        <div className="mcp-drawer-scrim" />
        <div className="mcp-drawer" />
      </>
    )
  }

  const ini = serverInitials(server.id)
  const commandLine = [server.cmd, ...(server.args ?? [])].filter(Boolean).join(' ')

  function handleCopyEndpoint() {
    if (!server) return
    writeTextToClipboard(server.endpoint)
    toast('Endpoint copied', { type: 'info', icon: '📋' })
  }

  return (
    <>
      {/* scrim */}
      <div className="mcp-drawer-scrim open" onClick={onClose} />

      {/* drawer panel */}
      <aside className="mcp-drawer open">
        {/* header */}
        <div className="mcp-drawer-hdr">
          <div className="mcp-glyph">{ini}</div>
          <div style={{ minWidth: 0 }}>
            <h2>{server.id}</h2>
            <div className="mcp-meta-line">
              <span>{server.transport}</span>
              <span>auth: {server.auth}</span>
              <span>{server.tools} tools</span>
              <span>{server.source}</span>
            </div>
          </div>
          <div className="mcp-hdr-actions">
            <button type="button" className="mcp-ico-btn" title="Copy endpoint" onClick={handleCopyEndpoint}>
              {Ico.copy}
            </button>
            <button type="button" className="mcp-ico-btn" title="Edit">
              {Ico.edit}
            </button>
            <button type="button" className="mcp-ico-btn" title="Delete" style={{ color: '#ff5fa2' }}>
              {Ico.trash}
            </button>
            <button type="button" className="mcp-ico-btn" onClick={onClose} title="Close (Esc)">
              {Ico.x}
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="mcp-drawer-tabs">
          <button type="button" className={cn(activeTab === 'overview' && 'on')} onClick={() => setActiveTab('overview')}>
            {Ico.shield}<span>Overview</span>
          </button>
          <button type="button" className={cn(activeTab === 'tools' && 'on')} onClick={() => setActiveTab('tools')}>
            {Ico.tool}<span>Tools</span>
            <span className="mcp-ct">{server.tools}</span>
          </button>
          <button type="button" className={cn(activeTab === 'config' && 'on')} onClick={() => setActiveTab('config')}>
            {Ico.doc}<span>Config</span>
          </button>
          <button type="button" className={cn(activeTab === 'logs' && 'on')} onClick={() => setActiveTab('logs')}>
            {Ico.log}<span>Logs</span>
          </button>
        </div>

        {/* body */}
        <div className="mcp-drawer-body">
          {activeTab === 'overview' && (
            <>
              <div className="mcp-panel-card">
                <div className="mcp-pc-hd">
                  <span>Endpoint</span>
                  <span className="mcp-right">{server.transport.toUpperCase()}</span>
                </div>
                <div className="mcp-pc-bd">
                  <div style={{ fontSize: 12 }}>{server.endpoint}</div>
                </div>
              </div>

              <div className="mcp-preview-grid">
                <div className="mcp-stat-card">
                  <div className="mcp-lbl">Status</div>
                  <b style={{ color: server.status === 'connected' ? 'var(--m-green-500, #00ff41)' : 'var(--m-text-faint, #3a5a4a)' }}>
                    {server.status}
                  </b>
                  <div className="mcp-sub">
                    {server.status === 'connected' ? 'Live introspection ok' : 'No probe yet — try Test'}
                  </div>
                </div>
                <div className="mcp-stat-card">
                  <div className="mcp-lbl">Tools</div>
                  <b>{server.tools}</b>
                  <div className="mcp-sub">{server.tools > 0 ? 'introspected' : 'awaiting probe'}</div>
                </div>
                <div className="mcp-stat-card">
                  <div className="mcp-lbl">Latency</div>
                  <b>{server.latency ? `${server.latency}ms` : '—'}</b>
                  <div className="mcp-sub">last test cycle</div>
                </div>
                <div className="mcp-stat-card">
                  <div className="mcp-lbl">Auth</div>
                  <b>{server.auth}</b>
                  <div className="mcp-sub">
                    {server.auth === 'bearer' ? 'token in env' : server.auth === 'oauth' ? 'oauth flow' : 'no credentials'}
                  </div>
                </div>
              </div>

              <div className="mcp-panel-card">
                <div className="mcp-pc-hd"><span>Quick actions</span></div>
                <div className="mcp-pc-bd" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="mcp-btn-mini">
                    {Ico.bolt} Test connection
                  </button>
                  <button type="button" className="mcp-btn-mini">Discover tools</button>
                  <button type="button" className="mcp-btn-mini">Restart</button>
                  <button type="button" className="mcp-btn-mini" onClick={handleCopyEndpoint}>Copy endpoint</button>
                  <button type="button" className="mcp-btn-mini mcp-danger">Disconnect</button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'tools' && (
            <div className="mcp-panel-card">
              <div className="mcp-pc-hd">
                <span>Exposed tools</span>
                <span className="mcp-right">{server.tools}</span>
              </div>
              <div className="mcp-tools-list">
                {toolEntries.length === 0 ? (
                  <div className="mcp-empty">
                    <div className="mcp-glyph">∅</div>
                    no tools introspected yet
                  </div>
                ) : (
                  toolEntries.map((t) => (
                    <div key={t.n} className="mcp-tool-row">
                      <span className="mcp-ic">{Ico.tool}</span>
                      <div>
                        <div className="mcp-nm">{t.n}</div>
                        <div className="mcp-desc">{t.d}</div>
                      </div>
                      <span className="mcp-right">callable</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'config' && (
            <div className="mcp-panel-card">
              <div className="mcp-pc-hd">
                <span>config.yaml entry</span>
                <span className="mcp-right">{server.source}</span>
              </div>
              <div className="mcp-pc-bd">
                <div className="mcp-config-preview">
                  <div><span style={{ color: '#5fcfff' }}>{server.id}</span>:</div>
                  <div>
                    {'  '}<span style={{ color: '#5fcfff' }}>transport</span>: <span style={{ color: '#d6ff5f' }}>{server.transport}</span>
                  </div>
                  {server.transport === 'stdio' ? (
                    <div>
                      {'  '}<span style={{ color: '#5fcfff' }}>command</span>: <span style={{ color: 'var(--m-text, #a0d4b8)' }}>{commandLine || server.endpoint}</span>
                    </div>
                  ) : (
                    <div>
                      {'  '}<span style={{ color: '#5fcfff' }}>url</span>: <span style={{ color: 'var(--m-text, #a0d4b8)' }}>{server.endpoint}</span>
                    </div>
                  )}
                  <div>
                    {'  '}<span style={{ color: '#5fcfff' }}>auth</span>: <span style={{ color: '#d6ff5f' }}>{server.auth}</span>
                  </div>
                  {server.auth === 'bearer' && (
                    <div>
                      {'  '}<span style={{ color: '#5fcfff' }}>token</span>: <span style={{ color: 'var(--m-text-faint, #3a5a4a)', fontStyle: 'italic' }}>
                        {'${ENV.'}{server.id.toUpperCase().replace(/-/g, '_')}_TOKEN{'}'}
                      </span>
                    </div>
                  )}
                  <div>
                    {'  '}<span style={{ color: '#5fcfff' }}>enabled</span>: <span style={{ color: '#d6ff5f' }}>{String(server.enabled)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="mcp-panel-card">
              <div className="mcp-pc-hd">
                <span>Recent log</span>
              </div>
              <div className="mcp-pc-bd">
                <div
                  className="mcp-empty"
                  style={{ textAlign: 'center', color: 'var(--m-text-faint, #3a5a4a)', padding: '24px 0' }}
                >
                  Live logs not yet available.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="mcp-drawer-foot">
          <span className="mcp-src-line">
            <span className="mcp-lbl">Source:</span>
            <code>{server.endpoint}</code>
          </span>
          <span
            className={cn('mcp-switch', server.enabled && 'on')}
            onClick={() => onToggle(server)}
          />
          {server.installed ? (
            <button type="button" className="mcp-btn mcp-btn-sm">Uninstall</button>
          ) : (
            <button type="button" className="mcp-btn mcp-btn-sm mcp-btn-primary">Install</button>
          )}
          <button type="button" className="mcp-btn mcp-btn-sm" onClick={onClose}>Close</button>
        </div>
      </aside>
    </>
  )
}
