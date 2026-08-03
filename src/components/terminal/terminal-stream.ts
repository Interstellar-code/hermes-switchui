export type TerminalStreamEvent = {
  event: string
  data: unknown
}

export async function postTerminalInput(
  sessionId: string,
  data: string,
): Promise<boolean> {
  const response = await fetch('/api/terminal-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, data }),
  }).catch(() => null)
  return Boolean(response?.ok)
}

export async function postTerminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<boolean> {
  const response = await fetch('/api/terminal-resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, cols, rows }),
  }).catch(() => null)
  return Boolean(response?.ok)
}

export async function closeTerminalSession(
  sessionId: string,
): Promise<boolean> {
  const response = await fetch('/api/terminal-close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => null)
  return Boolean(response?.ok)
}

export function parseTerminalEventBlock(
  block: string,
): TerminalStreamEvent | null {
  let event = ''
  const data: Array<string> = []

  for (const line of block.replaceAll('\r\n', '\n').split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }

  if (!event || event === 'ping') return null
  try {
    return { event, data: data.length ? JSON.parse(data.join('\n')) : null }
  } catch {
    return null
  }
}

export function createTerminalInputQueue(
  send: (data: string) => Promise<boolean>,
  delayMs = 8,
) {
  let pending = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let chain = Promise.resolve(true)

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return chain
    const data = pending
    pending = ''
    chain = chain.then(
      () => send(data),
      () => send(data),
    )
    return chain
  }

  return {
    push(data: string) {
      pending += data
      if (!timer) timer = setTimeout(() => void flush(), delayMs)
    },
    flush,
    clear() {
      pending = ''
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
