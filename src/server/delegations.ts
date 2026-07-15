import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getProfileClaudeHome } from './claude-paths'

export type DelegationStatus = 'running' | 'completed' | 'failed'

export type Delegation = {
  childSessionId: string
  goal: string
  model: string
  status: DelegationStatus
  inputTokens: number
  outputTokens: number
  startedAt: number | null
  endedAt: number | null
}

/**
 * Row shape returned by the sqlite query. Snake_case mirrors the `sessions`
 * table columns so `deriveDelegationStatus` reads the same fields the schema uses.
 */
export type DelegationRow = {
  id: string
  title: string | null
  model: string | null
  started_at: number | null
  ended_at: number | null
  end_reason: string | null
  input_tokens: number | null
  output_tokens: number | null
  /** MAX(messages.timestamp) for the child, seconds. Used for the staleness fallback. */
  last_active: number | null
}

const FAILURE_END_REASON = /error|fail|abort/i
// ponytail: most child sessions never get ended_at written (54 of 205 in real data),
// so a child idle longer than this is treated as completed rather than stuck "running".
// Ceiling: a genuinely long-idle live subagent (>3min between steps) reads as completed.
const STALE_AFTER_SECONDS = 180

/** Derive a delegation's lifecycle status. `nowSeconds` is injected for testability. */
export function deriveDelegationStatus(
  row: Pick<DelegationRow, 'ended_at' | 'end_reason' | 'last_active' | 'started_at'>,
  nowSeconds: number,
): DelegationStatus {
  if (row.ended_at) {
    return row.end_reason && FAILURE_END_REASON.test(row.end_reason) ? 'failed' : 'completed'
  }
  const lastRef = row.last_active ?? row.started_at
  if (lastRef != null && nowSeconds - lastRef > STALE_AFTER_SECONDS) return 'completed'
  return 'running'
}

/** Map a raw sqlite row to the API delegation shape. */
export function toDelegation(row: DelegationRow, nowSeconds = Date.now() / 1000): Delegation {
  return {
    childSessionId: row.id,
    goal: row.title || 'Untitled delegation',
    model: row.model || 'unknown',
    status: deriveDelegationStatus(row, nowSeconds),
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    startedAt: row.started_at ? row.started_at * 1000 : null,
    endedAt: row.ended_at ? row.ended_at * 1000 : null,
  }
}

// ponytail: local state.db read — the gateway REST /api/sessions projection nulls
// out parent_session_id, so the child->parent link only exists in the profile DB
// (same source crew-status.ts already depends on). Upgrade path: switch to REST if
// the gateway ever exposes parent linkage / a children endpoint.
const QUERY_SCRIPT = `
import json, sqlite3, sys

path, parent = sys.argv[1], sys.argv[2]
out = []
conn = sqlite3.connect("file:" + path + "?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

has = cur.execute(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions' LIMIT 1"
).fetchone()
if has is None:
    print(json.dumps(out)); raise SystemExit(0)

rows = cur.execute("""
SELECT s.id, s.title, s.model, s.started_at, s.ended_at, s.end_reason,
       s.input_tokens, s.output_tokens,
       (SELECT MAX(timestamp) FROM messages WHERE session_id = s.id) AS last_active
FROM sessions s
WHERE s.parent_session_id = ?
ORDER BY s.started_at DESC
""", (parent,)).fetchall()

for r in rows:
    title = r["title"]
    if not title:
        first = cur.execute(
          "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC, id ASC LIMIT 1",
          (r["id"],),
        ).fetchone()
        title = ((first["content"] if first else None) or "").strip()[:140] or None
    out.append({
      "id": r["id"], "title": title, "model": r["model"],
      "started_at": r["started_at"], "ended_at": r["ended_at"],
      "end_reason": r["end_reason"], "last_active": r["last_active"],
      "input_tokens": r["input_tokens"], "output_tokens": r["output_tokens"],
    })

conn.close()
print(json.dumps(out))
`

/** Read all delegations (child sessions) spawned by `parentSessionId` from the profile DB. */
export function readDelegationsForParent(parentSessionId: string): Array<Delegation> {
  const dbPath = join(getProfileClaudeHome('hermes-switch'), 'state.db')
  if (!existsSync(dbPath)) return []
  try {
    const raw = execFileSync(
      'python3',
      ['-c', QUERY_SCRIPT, dbPath, parentSessionId],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    const parsed = JSON.parse(raw) as Array<DelegationRow>
    if (!Array.isArray(parsed)) return []
    const nowSeconds = Date.now() / 1000
    return parsed.map((row) => toDelegation(row, nowSeconds))
  } catch {
    return []
  }
}
