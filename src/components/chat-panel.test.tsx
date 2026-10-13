// @vitest-environment jsdom
/**
 * perf-pass2 R2: the panel sessions key nests under chatQueryKeys.sessions
 * (read per render — the getter includes the active scope), so prefix
 * invalidations of the sessions list refresh the panel dropdown, while exact
 * setQueryData writes of the other (two-window) shape cannot leak into it.
 */
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { chatPanelSessionsKey } from './chat-panel'
import { chatQueryKeys } from '@/screens/chat/chat-queries'

describe('chatPanelSessionsKey', () => {
  it('nests under chatQueryKeys.sessions so prefix invalidation refreshes the panel', async () => {
    const client = new QueryClient()
    const panelKey = chatPanelSessionsKey()
    expect(panelKey.slice(0, chatQueryKeys.sessions.length)).toEqual(
      chatQueryKeys.sessions,
    )
    expect(panelKey.at(-1)).toBe('chat-panel')

    client.setQueryData(panelKey, [{ key: 'panel-1' }])
    await client.invalidateQueries({ queryKey: chatQueryKeys.sessions })
    expect(client.getQueryState(panelKey)?.isInvalidated).toBe(true)
  })

  it('exact writes to chatQueryKeys.sessions do not leak into the panel', () => {
    const client = new QueryClient()
    const panelKey = chatPanelSessionsKey()
    const panelData = [{ key: 'panel-1' }]
    client.setQueryData(panelKey, panelData)
    client.setQueryData(chatQueryKeys.sessions, [{ other: 'shape' }])
    expect(client.getQueryData(panelKey)).toEqual(panelData)
  })
})
