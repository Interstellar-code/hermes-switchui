import '@/styles/workflow-wizard-describe.css'
import { useEffect, useRef } from 'react'
import { GraphPreview } from './graph-preview'
import type { DraftRevision } from './use-describe-chat'

export type ChatMessage = { role: 'assistant' | 'user'; msg: string }

export interface DescribeChatPaneProps {
  chatHistory: Array<ChatMessage>
  chatInput: string
  chatPending: boolean
  onChatInput: (v: string) => void
  onSend: () => void
  wizardSessionId?: string | null
  revisions?: Array<DraftRevision>
  currentRevision?: number
  selectedRevision?: number
  onSelectRevision?: (rev: number) => void
  onUseDraft?: (rev?: number) => void
  unavailable?: boolean
  errorMessage?: string | null
  onSwitchToTemplate?: () => void
}

export function DescribeChatPane({
  chatHistory,
  chatInput,
  chatPending,
  onChatInput,
  onSend,
  wizardSessionId,
  revisions = [],
  selectedRevision,
  onSelectRevision,
  onUseDraft,
  unavailable = false,
  errorMessage,
  onSwitchToTemplate,
}: DescribeChatPaneProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof msgsEndRef.current?.scrollIntoView === 'function') {
      msgsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatHistory])

  const activeRev =
    (selectedRevision &&
      revisions.find((r) => r.revision === selectedRevision)) ||
    (revisions.length > 0 ? revisions[revisions.length - 1] : null)

  const addedNodes = activeRev?.diff.added ?? []
  const changedNodes = activeRev?.diff.changed ?? []

  return (
    <div className="wz-describe-root plan-chat">
      {unavailable && (
        <div className="wz-describe-offline-banner" role="alert">
          <div className="wz-describe-offline-text">
            <span>
              {errorMessage ||
                'AI drafting unavailable — start from a template'}
            </span>
          </div>
          {onSwitchToTemplate && (
            <button
              type="button"
              className="wz-describe-offline-btn"
              onClick={onSwitchToTemplate}
            >
              Start from a template
            </button>
          )}
        </div>
      )}

      {/* Left column: Draft Chat */}
      <section className="wz-describe-chat-col chat" aria-label="Draft chat">
        <div className="wz-describe-chat-header ch">
          <span className="ttl">DRAFT CHAT</span>
          {wizardSessionId && (
            <span className="wz-describe-session-badge meta">
              DRAFT SESSION {wizardSessionId}
            </span>
          )}
        </div>

        <div
          className="wz-describe-chat-msgs chat-msgs"
          role="log"
          aria-live="polite"
        >
          {chatHistory.map((m, i) => (
            <div key={i} className={`wz-describe-chat-msg chat-msg ${m.role}`}>
              <span className="wz-describe-chat-who chat-who">
                {m.role === 'assistant' ? 'Hermes' : 'You'}
              </span>
              <div className="chat-text">
                {m.msg.split('\n').map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
              </div>
            </div>
          ))}
          <div ref={msgsEndRef} />
        </div>

        {chatPending && (
          <p
            style={{
              fontSize: 10,
              color: 'var(--theme-success, #00ff41)',
              margin: '0 0 6px',
              padding: '0 2px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse"
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'currentColor',
                animation: 'pulse 1.2s cubic-bezier(0.4,0,0.6,1) infinite',
              }}
            />
            <span style={{ marginLeft: 4 }}>Hermes is thinking…</span>
          </p>
        )}

        <div className="wz-describe-chat-input-row chat-input-row">
          <input
            className="wz-describe-input chat-inp"
            placeholder="Describe your workflow in plain language…"
            value={chatInput}
            disabled={chatPending}
            onChange={(e) => onChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSend()
            }}
          />
          <button
            type="button"
            className="btn-mini prim"
            onClick={onSend}
            disabled={chatPending}
          >
            {chatPending ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </section>

      {/* Right column: Live Draft Graph */}
      <div
        className="wz-describe-graph-col canvas"
        role="region"
        aria-label="Live draft graph"
      >
        <div className="wz-describe-graph-head chd">
          <span className="wz-describe-graph-title ttl">LIVE DRAFT</span>
          <span className="wz-describe-graph-meta meta">
            {activeRev
              ? `Revision ${activeRev.revision}`
              : 'Waiting for prompt'}
          </span>
          <span className="grow" />
          {activeRev && (
            <span className="chip ok">REV {activeRev.revision}</span>
          )}
        </div>

        {revisions.length > 0 && (
          <div
            className="wz-describe-revisions revs"
            role="group"
            aria-label="Draft revisions"
          >
            {revisions.map((rev) => (
              <button
                key={rev.revision}
                type="button"
                className={`wz-describe-rev-btn rv ${
                  rev.revision === (activeRev?.revision ?? revisions.length)
                    ? 'active on'
                    : ''
                }`}
                onClick={() => onSelectRevision?.(rev.revision)}
              >
                REV {rev.revision}
              </button>
            ))}
          </div>
        )}

        {activeRev && (addedNodes.length > 0 || changedNodes.length > 0) && (
          <div
            className="wz-diff-badge-bar"
            role="group"
            aria-label="Node changes"
          >
            {addedNodes.map((id) => (
              <span
                key={`added-${id}`}
                className="wz-diff-badge wz-diff-badge--added chg-added"
              >
                ADDED: {id}
              </span>
            ))}
            {changedNodes.map((id) => (
              <span
                key={`changed-${id}`}
                className="wz-diff-badge wz-diff-badge--changed chg-changed"
              >
                CHANGED: {id}
              </span>
            ))}
          </div>
        )}

        <div className="wz-describe-canvas-wrap">
          <GraphPreview
            parsed={activeRev?.parsed ?? null}
            label={activeRev ? `Draft Revision ${activeRev.revision}` : 'Draft'}
            loading={chatPending && revisions.length === 0}
          />
        </div>

        {activeRev && (
          <div className="wz-describe-footer-actions">
            <button
              type="button"
              className="wz-describe-use-btn"
              onClick={() => onUseDraft?.(activeRev.revision)}
            >
              Use this draft
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
