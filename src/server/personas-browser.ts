import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Persona = {
  id: string
  category: string
  glyph: string
  name: string
  description: string
  tags: string[]
  system_prompt: string
  path: string
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function getPersonasRoot(): string {
  const hermesRoot =
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  return path.join(hermesRoot, 'personas')
}

// ── Frontmatter parsing ───────────────────────────────────────────────────────

type FrontmatterResult = {
  data: Record<string, unknown>
  body: string
} | null

function parseFrontmatter(text: string): FrontmatterResult {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  try {
    const data = YAML.parse(match[1]) as Record<string, unknown>
    return { data, body: match[2] ?? '' }
  } catch {
    return null
  }
}

// ── Core readers ──────────────────────────────────────────────────────────────

function parsePersonaFile(filePath: string): Persona | null {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const fm = parseFrontmatter(text)
  if (!fm) {
    console.warn(`[personas] Skipping ${filePath} — no YAML frontmatter found`)
    return null
  }

  const { data, body } = fm

  // Validate required frontmatter keys
  if (
    typeof data.id !== 'string' ||
    typeof data.category !== 'string' ||
    typeof data.glyph !== 'string' ||
    typeof data.name !== 'string'
  ) {
    console.warn(`[personas] Skipping ${filePath} — missing required frontmatter keys (id, category, glyph, name)`)
    return null
  }

  return {
    id: data.id,
    category: data.category,
    glyph: data.glyph,
    name: data.name,
    description: typeof data.description === 'string' ? data.description : '',
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    system_prompt: body.trim(),
    path: filePath,
  }
}

export function listPersonas(): Persona[] {
  const root = getPersonasRoot()
  if (!fs.existsSync(root)) return []

  const personas: Persona[] = []
  const seenIds = new Map<string, string>() // id → filePath

  let categoryEntries: fs.Dirent[]
  try {
    categoryEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }

  for (const categoryEntry of categoryEntries) {
    if (!categoryEntry.isDirectory()) continue
    const categoryDir = path.join(root, categoryEntry.name)

    let fileEntries: fs.Dirent[]
    try {
      fileEntries = fs.readdirSync(categoryDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue
      const filePath = path.join(categoryDir, fileEntry.name)
      const persona = parsePersonaFile(filePath)
      if (!persona) continue

      // Duplicate id check
      if (seenIds.has(persona.id)) {
        throw new Error(
          `[personas] Duplicate persona id "${persona.id}" found in:\n  ${seenIds.get(persona.id)}\n  ${filePath}`,
        )
      }
      seenIds.set(persona.id, filePath)
      personas.push(persona)
    }
  }

  return personas.sort((a, b) =>
    a.category !== b.category
      ? a.category.localeCompare(b.category)
      : a.name.localeCompare(b.name),
  )
}

export function readPersona(id: string): Persona | null {
  const root = getPersonasRoot()
  if (!fs.existsSync(root)) return null

  let categoryEntries: fs.Dirent[]
  try {
    categoryEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }

  for (const categoryEntry of categoryEntries) {
    if (!categoryEntry.isDirectory()) continue
    const categoryDir = path.join(root, categoryEntry.name)

    let fileEntries: fs.Dirent[]
    try {
      fileEntries = fs.readdirSync(categoryDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const fileEntry of fileEntries) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.md')) continue
      const filePath = path.join(categoryDir, fileEntry.name)
      const persona = parsePersonaFile(filePath)
      if (persona && persona.id === id) return persona
    }
  }

  return null
}
