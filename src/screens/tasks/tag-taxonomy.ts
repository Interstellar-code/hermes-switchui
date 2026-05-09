/**
 * tag-taxonomy.ts — derive display tags from a ClaudeTask.
 *
 * Priority: task.metadata.tags → task.tags → keyword-match on title (max 2).
 */
import type { ClaudeTask } from '@/lib/tasks-api'

export type TagKind = 'research' | 'llm' | 'arch' | 'import' | 'batch'

export type Tag = {
  label: string
  kind: TagKind
}

const KEYWORD_RULES: Array<{ re: RegExp; kind: TagKind; label: string }> = [
  { re: /\b(research|survey|study|investigate|analyse|analyze|paper|review|explore|exploration)\b/i, kind: 'research', label: 'research' },
  { re: /\b(llm|gpt|claude|gemini|model|prompt|completion|inference|embedding|deepseek|anthropic|openai|mistral|token|tokenize)\b/i, kind: 'llm', label: 'llm' },
  { re: /\b(arch|architecture|design|refactor|structure|schema|scaffold|infra|infrastructure|system|blueprint)\b/i, kind: 'arch', label: 'arch' },
  { re: /\b(import|migration|migrate|ingest|load|parse|etl|pipeline|sync|transfer|export)\b/i, kind: 'import', label: 'import' },
  { re: /\b(batch|bulk|parallel|queue|job|worker|cron|schedule|gtw|gateway|dispatch|throughput)\b/i, kind: 'batch', label: 'batch' },
]

const KIND_ORDER: Array<TagKind> = ['research', 'llm', 'arch', 'import', 'batch']

function normaliseKind(raw: string): TagKind | null {
  const r = raw.toLowerCase().trim()
  if (KIND_ORDER.includes(r as TagKind)) return r as TagKind
  // fuzzy match
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(r)) return rule.kind
  }
  return null
}

export function deriveTags(task: ClaudeTask): Array<Tag> {
  // 1. metadata.tags (array of strings)
  const metaTags = ((task as unknown as { metadata?: { tags?: unknown } }).metadata)?.tags
  if (Array.isArray(metaTags) && metaTags.length > 0) {
    return metaTags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => {
        const kind = normaliseKind(t) ?? 'batch'
        return { label: t.toLowerCase(), kind }
      })
      .slice(0, 5)
  }

  // 2. task.tags (array of strings) — some gateway versions expose this directly
  const rawTags = (task as unknown as { tags?: unknown }).tags
  if (Array.isArray(rawTags) && rawTags.length > 0) {
    return (rawTags as Array<string>)
      .filter((t): t is string => typeof t === 'string')
      .map((t) => {
        const kind = normaliseKind(t) ?? 'batch'
        return { label: t.toLowerCase(), kind }
      })
      .slice(0, 5)
  }

  // 3. Keyword match on title (max 2)
  const title = task.title ?? ''
  const derived: Array<Tag> = []
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(title)) {
      derived.push({ label: rule.label, kind: rule.kind })
      if (derived.length >= 2) break
    }
  }
  return derived
}
