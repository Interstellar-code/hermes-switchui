import { describe, expect, it, vi } from 'vitest'
import {
  createTerminalInputQueue,
  parseTerminalEventBlock,
} from './terminal-stream'

describe('parseTerminalEventBlock', () => {
  it('parses CRLF and multiline data safely', () => {
    expect(
      parseTerminalEventBlock(
        'event: data\r\ndata: {"data":\r\ndata: "hello"}\r\n',
      ),
    ).toEqual({
      event: 'data',
      data: { data: 'hello' },
    })
  })

  it('ignores ping and malformed JSON', () => {
    expect(parseTerminalEventBlock('event: ping\ndata: {}')).toBeNull()
    expect(parseTerminalEventBlock('event: data\ndata: nope')).toBeNull()
  })
})

describe('createTerminalInputQueue', () => {
  it('batches input and preserves request order', async () => {
    vi.useFakeTimers()
    const calls: Array<string> = []
    const queue = createTerminalInputQueue((data) => {
      calls.push(data)
      return Promise.resolve(true)
    })
    queue.push('a')
    queue.push('b')
    await vi.runAllTimersAsync()
    queue.push('c')
    await queue.flush()
    expect(calls).toEqual(['ab', 'c'])
    vi.useRealTimers()
  })
})
