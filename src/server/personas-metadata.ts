import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

export const PersonaMetaEntrySchema = z.object({
  sourceFile: z.string(),
  category: z.string(),
  glyph: z.string().regex(/^[A-Z0-9]{1,3}$/, 'glyph must be 1-3 uppercase chars'),
  name: z.string(),
  description: z.string().max(200),
  tags: z.array(z.string()),
})

export type PersonaMetaEntry = z.infer<typeof PersonaMetaEntrySchema>

export const PersonasMetadataSchema = z.record(z.string(), PersonaMetaEntrySchema)

export type PersonasMetadata = z.infer<typeof PersonasMetadataSchema>

// ── Loader ────────────────────────────────────────────────────────────────────

let _cached: PersonasMetadata | null = null

export function loadPersonasMetadata(): PersonasMetadata {
  if (_cached) return _cached
  const metaPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../assets/personas-metadata.json',
  )
  const raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as unknown
  _cached = PersonasMetadataSchema.parse(raw)
  return _cached
}

/** Returns the metadata entry whose sourceFile matches the given basename, or undefined. */
export function findMetaBySourceFile(
  meta: PersonasMetadata,
  sourceFile: string,
): { id: string; entry: PersonaMetaEntry } | undefined {
  for (const [id, entry] of Object.entries(meta)) {
    if (entry.sourceFile === sourceFile) return { id, entry }
  }
  return undefined
}
