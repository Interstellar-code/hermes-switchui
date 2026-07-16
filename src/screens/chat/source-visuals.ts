import type { SessionSource } from './sessions-feed-types'

export const SOURCE_COLORS: Record<SessionSource, string> = {
  chat: 'var(--m-green-400, #00ff41)',
  recovered: '#7dff9a',
  task: '#ff9f5f',
  cron: '#d6ff5f',
  api: '#5fcfff',
  cli: '#5fffd6',
  a2a: '#c85fff',
  tool: '#b98aff',
  tg: '#ff5fa2',
}

export const SOURCE_LABELS: Record<SessionSource, string> = {
  chat: 'CHAT',
  recovered: 'RECOVERED',
  task: 'TASK',
  cron: 'CRON',
  api: 'API',
  cli: 'CLI',
  a2a: 'A2A',
  tool: 'TOOLS',
  tg: 'TELEGRAM',
}
