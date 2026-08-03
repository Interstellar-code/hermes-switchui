import { afterEach, describe, expect, it } from 'vitest'
import {
  closeTerminalSession,
  createTerminalSession,
} from './terminal-sessions'

const sessions: Array<string> = []

afterEach(() => {
  for (const id of sessions.splice(0)) closeTerminalSession(id)
})

describe('terminal session resize', () => {
  it('updates the live PTY dimensions through its control channel', async () => {
    const session = createTerminalSession({
      command: ['/bin/bash', '-c', 'stty size; sleep 0.25; stty size'],
      cols: 80,
      rows: 24,
    })
    sessions.push(session.id)

    const output = await new Promise<string>((resolve, reject) => {
      let data = ''
      let resized = false
      const timeout = setTimeout(
        () => reject(new Error('terminal timed out')),
        2_000,
      )
      session.emitter.on('event', (event) => {
        if (event.event === 'data') {
          data += String((event.payload as { data: string }).data)
          if (!resized && /24\s+80/.test(data)) {
            resized = true
            session.resize(123, 37)
          }
        }
        if (event.event === 'exit') {
          clearTimeout(timeout)
          resolve(data)
        }
      })
    })

    expect(output).toMatch(/24\s+80/)
    expect(output).toMatch(/37\s+123/)
  })
})
