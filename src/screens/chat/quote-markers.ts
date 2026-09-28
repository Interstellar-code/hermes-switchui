// Outgoing quote/reply markers and their parser. Quotes travel to the agent as
// real markdown blockquotes carrying the full selected passage; the reply
// marker keeps its legacy one-line `> [Re: #N] snippet` shape.

export const QUOTE_TEXT_LIMIT = 4000
export const REPLY_MARKER_SNIPPET_LIMIT = 140

export type QuoteRef = { seq: number; text: string }
export type ReplyRef = { seq: number; role: string; preview: string }
export type ParsedMarkers = {
  quotes: Array<QuoteRef>
  reply: { seq: number; snippet: string } | null
  body: string
}

const QUOTE_HEADER_PATTERN = /^>\s*\[Quote:\s*#(\d+)\]\s*$/
const SENTINEL_REPLY_MARKER_PATTERN =
  /^\u200B\[reply:#(\d+)\]\s*([^\r\n]*)(?:\r?\n){2}/
const BLOCKQUOTE_REPLY_MARKER_PATTERN =
  /^>\s*\[Re:\s*#(\d+)\]\s*([^\r\n]*)(?:\r?\n){2}/

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeQuoteText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  if (text.length <= QUOTE_TEXT_LIMIT) return text
  return `${text.slice(0, QUOTE_TEXT_LIMIT).trimEnd()}…`
}

function formatQuoteBlock(quote: QuoteRef): string {
  const lines = quote.text
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
  return [`> [Quote: #${quote.seq}]`, ...lines].join('\n')
}

export function formatReplyMarker(replyTo: ReplyRef): string {
  const preview = collapseWhitespace(replyTo.preview)
  const snippet =
    preview.length > REPLY_MARKER_SNIPPET_LIMIT
      ? `${preview.slice(0, REPLY_MARKER_SNIPPET_LIMIT).trimEnd()}…`
      : preview
  return `> [Re: #${replyTo.seq}] ${snippet}\n\n`
}

export function formatOutgoingMessage({
  quotes,
  replyTo,
  body,
}: {
  quotes: Array<QuoteRef>
  replyTo: ReplyRef | null
  body: string
}): string {
  const quoteBlocks = quotes.map((quote) => `${formatQuoteBlock(quote)}\n\n`)
  return `${quoteBlocks.join('')}${replyTo ? formatReplyMarker(replyTo) : ''}${body}`
}

export function parseMessageMarkers(content: string): ParsedMarkers {
  const quotes: Array<QuoteRef> = []
  let rest = content.replace(/\r\n/g, '\n')

  // Leading quote blocks: header line, then `>` lines, then a blank line.
  for (;;) {
    const lines = rest.split('\n')
    const header = lines[0].match(QUOTE_HEADER_PATTERN)
    if (!header) break
    let end = 1
    while (end < lines.length && /^>( |$)/.test(lines[end])) end += 1
    if (end < lines.length && lines[end] !== '') break
    quotes.push({
      seq: Number.parseInt(header[1], 10),
      text: lines
        .slice(1, end)
        .map((line) => line.replace(/^> ?/, ''))
        .join('\n'),
    })
    rest = lines.slice(end + 1).join('\n')
  }

  const replyMatch =
    rest.match(SENTINEL_REPLY_MARKER_PATTERN) ??
    rest.match(BLOCKQUOTE_REPLY_MARKER_PATTERN)
  const reply = replyMatch
    ? {
        seq: Number.parseInt(replyMatch[1], 10),
        snippet: collapseWhitespace(replyMatch[2]),
      }
    : null
  if (replyMatch) rest = rest.slice(replyMatch[0].length)

  if (quotes.length === 0 && !reply) return { quotes, reply, body: content }
  return { quotes, reply, body: rest }
}

// 1-based position in the unfiltered history. Identity first; display
// mapping can clone rows, so fall back to the message id.
export function stableMessageSeq<T extends { id?: string }>(
  history: Array<T>,
  message: T,
): number {
  const byIdentity = history.indexOf(message)
  if (byIdentity >= 0) return byIdentity + 1
  const byId = message.id ? history.findIndex((m) => m.id === message.id) : -1
  return byId >= 0 ? byId + 1 : history.length + 1
}
