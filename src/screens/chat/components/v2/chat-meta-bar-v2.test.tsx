// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMetaBarV2 } from './chat-meta-bar-v2'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })))
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderInto(ui: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  act(() => {
    createRoot(container).render(ui)
  })
  return container
}

describe('ChatMetaBarV2', () => {
  it('renders tools field with count', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="t_49b85d13" isStreaming={false} toolCount={14} profile="default" />,
    )
    const tools = container.querySelector('[data-testid="meta-tools"]')
    expect(tools?.textContent).toContain('14')
  })

  it('renders profile field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={false} toolCount={0} profile="default" />,
    )
    const profile = container.querySelector('[data-testid="meta-profile"]')
    expect(profile?.textContent).toContain('default')
  })

  it('renders session id field', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="t_49b85d13" />,
    )
    const sid = container.querySelector('[data-testid="meta-session-id"]')
    expect(sid?.textContent).toContain('session')
  })

  it('shows tok/s when streaming and tokPerSec provided', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={true} tokPerSec={37} toolCount={0} />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps?.textContent).toContain('37')
  })

  it('hides tok/s when not streaming', () => {
    const container = renderInto(
      <ChatMetaBarV2 sessionKey="abc" isStreaming={false} tokPerSec={37} toolCount={0} />,
    )
    const tps = container.querySelector('[data-testid="tok-per-sec"]')
    expect(tps).toBeNull()
  })

  it('shows default profile placeholder when not provided', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey="abc" />)
    const profile = container.querySelector('[data-testid="meta-profile"]')
    expect(profile?.textContent).toContain('default')
  })

  it('renders model field (— placeholder before fetch resolves)', () => {
    const container = renderInto(<ChatMetaBarV2 sessionKey={null} />)
    const model = container.querySelector('[data-testid="meta-model"]')
    expect(model?.textContent).toContain('—')
  })
})
