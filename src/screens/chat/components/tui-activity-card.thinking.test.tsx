// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { TuiActivityCard } from './tui-activity-card'
import type { TuiToolSection } from './tui-activity-card'

/**
 * Reasoning text had exactly one paint site in the app — `ThinkingRow` inside
 * `TuiActivityCard` — and both of that component's callers passed `null` or
 * omitted the prop, so it was dead code. The agent was delivering reasoning
 * (`tool.progress` / `_thinking`), `send-stream.ts` was translating it, and
 * the store was keeping it as a `{type:'thinking'}` content part; none of that
 * was ever shown.
 *
 * The transport half already had tests (-send-stream-reasoning.test.ts). They
 * passed the whole time the view was dead, because nothing asserted that
 * anything rendered. Hence both halves here: the renderer works, AND the
 * caller actually hands it the value.
 */

const tool = (key: string, type: string): TuiToolSection => ({
  key,
  type,
  outputText: '',
  state: 'output-available',
})

const noop = () => ''

function renderCard(props: Partial<Parameters<typeof TuiActivityCard>[0]>) {
  return render(
    <TuiActivityCard
      toolSections={[]}
      isStreaming={false}
      formatLabel={noop}
      formatArg={noop}
      {...props}
    />,
  )
}

afterEach(cleanup)

describe('TuiActivityCard — reasoning', () => {
  it('renders reasoning on a turn that used no tools', () => {
    // The regression case. Gating the card on tool count hid reasoning on
    // exactly the plain question-and-answer turns where it is most visible.
    renderCard({ thinking: 'Weighing two approaches before answering.' })

    expect(
      screen.getByText('Weighing two approaches before answering.'),
    ).toBeDefined()
    expect(screen.getByText('ACTIVITY')).toBeDefined()
  })

  it('renders reasoning alongside tools', () => {
    renderCard({
      thinking: 'Checking the config first.',
      toolSections: [tool('t1', 'bash')],
    })

    expect(screen.getByText('Checking the config first.')).toBeDefined()
    expect(screen.getByText('ACTIVITY · 1 TOOL')).toBeDefined()
  })

  it('renders nothing when there is neither reasoning nor tools', () => {
    const { container } = renderCard({ thinking: null })
    expect(container.firstChild).toBeNull()
  })

  it('treats whitespace-only reasoning as absent', () => {
    // `hasThinking` trims; an empty card would otherwise appear on every turn
    // where the agent emitted a blank _thinking frame.
    const { container } = renderCard({ thinking: '   \n  ' })
    expect(container.firstChild).toBeNull()
  })
})

// Not `new URL(..., import.meta.url)` — this suite runs under jsdom, where
// import.meta.url is an http: URL that readFileSync rejects.
const readSource = (file: string) =>
  readFileSync(
    resolve(process.cwd(), 'src/screens/chat/components', file),
    'utf8',
  )

describe('MessageItem wiring — settled turns', () => {
  const source = readSource('message-item.tsx')

  it('passes the computed reasoning into TuiActivityCard', () => {
    // This is the line that was `thinking={null}`. A renderer nothing feeds is
    // indistinguishable from a renderer that does not exist.
    expect(source).toContain('thinking={thinking}')
    expect(source).not.toContain('thinking={null}')
  })

  it('does not gate the card on tool count alone', () => {
    expect(source).toContain(
      '(finalToolSections.length > 0 || !!thinking?.trim())',
    )
  })
})

describe('ChatMessageList wiring — live streaming turns', () => {
  // TuiActivityCard has TWO callers. Fixing only message-item.tsx left
  // reasoning invisible for the entire streaming phase — the one stretch where
  // the user is staring at a bubble that says "Thinking…" and nothing else.
  // Both call sites are asserted here so a future fix cannot be half-applied.
  const source = readSource('chat-message-list.tsx')

  it('passes live reasoning into the streaming TuiActivityCard', () => {
    expect(source).toContain('thinking={streamingThinking ?? null}')
    expect(source).not.toContain('thinking={null}')
  })

  it('branches on reasoning even when no tool has been called yet', () => {
    expect(source).toContain('!!streamingThinking?.trim()')
  })
})
