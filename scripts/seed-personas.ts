#!/usr/bin/env tsx
/**
 * seed-personas.ts — Seeds ~/.hermes/personas/ from a curated corpus.
 *
 * Usage:
 *   pnpm seed-personas [options]
 *
 * Options:
 *   --source <dir>      Source corpus dir (default: STELLAR_PERSONAS_DIR env or the curated path below)
 *   --target <dir>      Target dir (default: ~/.hermes/personas)
 *   --overwrite         Overwrite existing files (default: false — skip unchanged)
 *   --dry-run           Print planned writes without touching disk
 *   --curated-only      Only seed files listed in assets/personas-metadata.json (default: true)
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : undefined
}

function hasFlag(flag: string): boolean {
  return args.includes(flag)
}

const DEFAULT_SOURCE = process.env.STELLAR_PERSONAS_DIR
  ?? '/Volumes/Ext-nvme/Development/stellar-powers/personas/curated'

const sourceDir = getArg('--source') ?? DEFAULT_SOURCE
const targetDir = getArg('--target') ?? path.join(os.homedir(), '.hermes', 'personas')
const overwrite = hasFlag('--overwrite')
const dryRun = hasFlag('--dry-run')
// curated-only is default true; pass --no-curated-only to disable
const curatedOnly = !hasFlag('--no-curated-only')

// ── Load metadata ─────────────────────────────────────────────────────────────

const metaPath = path.join(REPO_ROOT, 'assets', 'personas-metadata.json')
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Record<
  string,
  {
    sourceFile: string
    category: string
    glyph: string
    name: string
    description: string
    tags: string[]
  }
>

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFrontmatter(
  id: string,
  entry: (typeof meta)[string],
): string {
  return YAML.stringify({
    id,
    category: entry.category,
    glyph: entry.glyph,
    name: entry.name,
    description: entry.description,
    tags: entry.tags,
  })
}

function readSourceBody(sourceFile: string): string {
  const srcPath = path.join(sourceDir, sourceFile)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Source file not found: ${srcPath}`)
  }
  return fs.readFileSync(srcPath, 'utf-8').trim()
}

// ── Glyph collision check within category ─────────────────────────────────────

const glyphsByCategory = new Map<string, Map<string, string>>() // category → glyph → id
for (const [id, entry] of Object.entries(meta)) {
  if (!glyphsByCategory.has(entry.category)) {
    glyphsByCategory.set(entry.category, new Map())
  }
  const catGlyphs = glyphsByCategory.get(entry.category)!
  if (catGlyphs.has(entry.glyph)) {
    throw new Error(
      `Glyph collision: "${entry.glyph}" used by both "${catGlyphs.get(entry.glyph)}" and "${id}" in category "${entry.category}"`,
    )
  }
  catGlyphs.set(entry.glyph, id)
}

// ── Seed ──────────────────────────────────────────────────────────────────────

let written = 0
let skipped = 0

const entriesToProcess = curatedOnly
  ? Object.entries(meta)
  : Object.entries(meta) // For future 156-corpus support, extend here

for (const [id, entry] of entriesToProcess) {
  const body = readSourceBody(entry.sourceFile)
  const frontmatter = buildFrontmatter(id, entry)
  const content = `---\n${frontmatter}---\n${body}\n`

  const outDir = path.join(targetDir, entry.category)
  const outPath = path.join(outDir, `${id}.md`)

  // Idempotent check
  if (!overwrite && fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, 'utf-8')
    if (existing === content) {
      console.log(`  skip  ${outPath} (unchanged)`)
      skipped++
      continue
    }
  }

  if (dryRun) {
    console.log(`  [dry-run] would write → ${outPath}`)
    written++
    continue
  }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outPath, content, 'utf-8')
  console.log(`  write → ${outPath}`)
  written++
}

console.log(`\nDone: wrote ${written} personas, skipped ${skipped} unchanged.`)
