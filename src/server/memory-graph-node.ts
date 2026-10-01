/**
 * memory-graph-node — full detail for one Memory Map node
 * (GET /api/memory/graph/node?id=…).
 *
 * The graph endpoint only ships 60-char labels; this resolves a single node id
 * back to its source row in the mnemosyne DB (read-only, parameterized) or,
 * for wiki nodes, to the knowledge page (readKnowledgePage is root-checked).
 */

import { readKnowledgePage } from './knowledge-browser'
import {
  classifyById,
  openMemoryGraphDb,
  tableExists,
  truncateLabel,
  wikiLabel,
} from './memory-graph'
import type Database from 'better-sqlite3'
import type { MemoryGraphKind } from './memory-graph'

export type MemoryGraphNodeDetail = {
  id: string
  kind: MemoryGraphKind
  label: string
  text: string
  createdAt: string | null
  updatedAt: string | null
  source: Record<string, string | number>
}

export const NODE_ID_MAX = 1024

// Provenance columns worth showing; anything else (vectors, json blobs of
// internals) stays server-side. Only keys present on the row are returned.
const SOURCE_KEYS = [
  'subject',
  'predicate',
  'object',
  'confidence',
  'source',
  'session_id',
  'source_msg_id',
  'memory_id',
  'memory_type',
  'importance',
  'veracity',
  'trust_tier',
  'recall_count',
  'last_recalled',
  'pinned',
  'tier',
  'summary_of',
  'location',
  'emotion',
  'time_scope',
] as const

type Row = Record<string, unknown>

function pickSource(row: Row): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const k of SOURCE_KEYS) {
    const v = row[k]
    if ((typeof v === 'string' && v !== '') || typeof v === 'number') out[k] = v
  }
  return out
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null

// Table + key column per DB-backed kind; the id prefix is stripped first.
const ROW_SOURCES: Partial<
  Record<
    MemoryGraphKind,
    { table: string; key: string; prefix: string; text: (r: Row) => string }
  >
> = {
  gist: {
    table: 'gists',
    key: 'id',
    prefix: '',
    text: (r) => String(r.text ?? ''),
  },
  working: {
    table: 'working_memory',
    key: 'id',
    prefix: 'wm_',
    text: (r) => String(r.content ?? ''),
  },
  fact: {
    table: 'facts',
    key: 'fact_id',
    prefix: '',
    text: (r) =>
      [r.subject, r.predicate, r.object]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' '),
  },
  episodic: {
    table: 'episodic_memory',
    key: 'id',
    prefix: 'ep_',
    text: (r) => String(r.content ?? ''),
  },
}

function entityDetail(
  db: Database.Database,
  id: string,
): MemoryGraphNodeDetail | null {
  const name = id.slice('entity:'.length).trim()
  if (!name) return null
  const count = (table: string, sql: string, ...args: Array<string>): number =>
    tableExists(db, table)
      ? (db.prepare(sql).get(...args) as { n: number }).n
      : 0
  const facts = count(
    'facts',
    'SELECT COUNT(*) AS n FROM facts WHERE subject = ? OR object = ?',
    name,
    name,
  )
  const mentions = count(
    'annotations',
    "SELECT COUNT(*) AS n FROM annotations WHERE kind = 'mentions' AND value = ?",
    name,
  )
  const relations =
    count(
      'memoria_kg',
      'SELECT COUNT(*) AS n FROM memoria_kg WHERE subject = ? OR object = ?',
      name,
      name,
    ) +
    count(
      'triples',
      'SELECT COUNT(*) AS n FROM triples WHERE subject = ? OR object = ?',
      name,
      name,
    )
  if (facts + mentions + relations === 0) return null
  return {
    id,
    kind: 'entity',
    label: truncateLabel(name),
    text: name,
    createdAt: null,
    updatedAt: null,
    source: { facts, mentions, relations },
  }
}

function wikiDetail(id: string): MemoryGraphNodeDetail | null {
  try {
    const page = readKnowledgePage(id)
    return {
      id,
      kind: 'wiki',
      label: page.meta.title || wikiLabel(id),
      text: page.content,
      createdAt: page.meta.created ?? null,
      updatedAt: page.meta.updated ?? page.meta.modified,
      source: { path: page.meta.path, backlinks: page.backlinks.length },
    }
  } catch {
    // outside the wiki root, not .md, or missing — all "unknown node"
    return null
  }
}

/** Resolve one graph node id to its full record; null when unknown. */
export function getMemoryGraphNode(id: string): MemoryGraphNodeDetail | null {
  if (!id || id.length > NODE_ID_MAX || id.includes('\0')) return null
  const kind = classifyById(id)
  if (kind === 'wiki') return wikiDetail(id)

  const db = openMemoryGraphDb()
  if (!db) return null
  try {
    if (kind === 'entity') return entityDetail(db, id)
    const src = ROW_SOURCES[kind]
    if (!src || !tableExists(db, src.table)) return null
    // table/key are constants from ROW_SOURCES; only the id is user input.
    const row = db
      .prepare(`SELECT * FROM ${src.table} WHERE ${src.key} = ? LIMIT 1`)
      .get(id.slice(src.prefix.length)) as Row | undefined
    if (!row) return null
    const text = src.text(row)
    return {
      id,
      kind,
      label: truncateLabel(text),
      text,
      createdAt: str(row.created_at) ?? str(row.timestamp),
      updatedAt: str(row.consolidated_at) ?? str(row.last_recalled),
      source: pickSource(row),
    }
  } finally {
    db.close()
  }
}
