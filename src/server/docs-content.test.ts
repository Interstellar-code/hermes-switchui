import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getAllPages,
  scanDocsTree,
  loadDocPage,
  getAdjacentPages,
  loadDocsManifest,
} from './docs-content'

let tmpDir: string
let manifestPath: string

function writeDoc(rel: string, body: string) {
  const full = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, 'utf-8')
}

function writeManifest(pages: Array<{ slug: string; title?: string }>) {
  const entries = pages
    .map((p) =>
      p.title
        ? `  - slug: ${p.slug}\n    title: ${p.title}`
        : `  - slug: ${p.slug}`,
    )
    .join('\n')
  fs.writeFileSync(manifestPath, `pages:\n${entries}\n`, 'utf-8')
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-content-'))
  manifestPath = path.join(tmpDir, 'docs-manifest.yaml')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadDocsManifest', () => {
  it('parses a valid manifest', () => {
    writeManifest([
      { slug: 'a', title: 'Alpha' },
      { slug: 'b' },
    ])
    const manifest = loadDocsManifest(manifestPath)
    expect(manifest.pages).toHaveLength(2)
    expect(manifest.pages[0]).toEqual({ slug: 'a', title: 'Alpha' })
    expect(manifest.pages[1]).toEqual({ slug: 'b' })
  })

  it('throws on invalid manifest shape', () => {
    fs.writeFileSync(manifestPath, 'not_pages: []', 'utf-8')
    expect(() => loadDocsManifest(manifestPath)).toThrow('invalid shape')
  })
})

describe('getAllPages', () => {
  it('returns only pages listed in manifest, in manifest order', () => {
    writeManifest([
      { slug: 'b', title: 'B' },
      { slug: 'a', title: 'A' },
    ])
    writeDoc('a.md', '# A\nbody')
    writeDoc('b.md', '# B\nbody')
    writeDoc('c.md', '# C\nnot in manifest')

    const pages = getAllPages(tmpDir, manifestPath)
    expect(pages.map((p) => p.slug)).toEqual(['b', 'a'])
  })

  it('skips manifest entries whose .md file does not exist', () => {
    writeManifest([
      { slug: 'exists', title: 'Exists' },
      { slug: 'missing', title: 'Missing' },
    ])
    writeDoc('exists.md', '# Exists')

    const pages = getAllPages(tmpDir, manifestPath)
    expect(pages.map((p) => p.slug)).toEqual(['exists'])
  })

  it('uses manifest title over frontmatter title over filename humanized', () => {
    writeManifest([
      { slug: 'alpha', title: 'Manifest Title' },
      { slug: 'beta' },
      { slug: 'gamma' },
    ])
    writeDoc('alpha.md', '---\ntitle: FM Title\n---\nbody')
    writeDoc('beta.md', '---\ntitle: FM Beta\n---\nbody')
    writeDoc('gamma.md', '# body only')

    const pages = getAllPages(tmpDir, manifestPath)
    expect(pages[0]!.title).toBe('Manifest Title')
    expect(pages[1]!.title).toBe('FM Beta')
    expect(pages[2]!.title).toBe('gamma')
  })

  it('tolerates published/order frontmatter without using them for filtering or sorting', () => {
    writeManifest([
      { slug: 'b', title: 'B' },
      { slug: 'a', title: 'A' },
    ])
    writeDoc('a.md', '---\npublished: true\norder: 1\ntitle: Old A\n---\nbody')
    writeDoc('b.md', '---\npublished: false\norder: 99\ntitle: Old B\n---\nbody')

    const pages = getAllPages(tmpDir, manifestPath)
    // manifest order wins (b first), published gate ignored, manifest title wins
    expect(pages.map((p) => p.slug)).toEqual(['b', 'a'])
    expect(pages[0]!.title).toBe('B')
    expect(pages[1]!.title).toBe('A')
  })
})

describe('loadDocPage', () => {
  it('returns page for slug in manifest', () => {
    writeManifest([{ slug: 'troubleshooting', title: 'Troubleshooting' }])
    writeDoc('troubleshooting.md', '# Troubleshooting\nbody')

    const page = loadDocPage('troubleshooting', tmpDir, manifestPath)
    expect(page).not.toBeNull()
    expect(page!.title).toBe('Troubleshooting')
  })

  it('returns null for slug not in manifest (404 case)', () => {
    writeManifest([{ slug: 'a', title: 'A' }])
    writeDoc('a.md', '# A')
    writeDoc('secret.md', '# Secret')

    expect(loadDocPage('secret', tmpDir, manifestPath)).toBeNull()
  })

  it('returns null for slug in manifest but missing .md file', () => {
    writeManifest([{ slug: 'ghost', title: 'Ghost' }])
    expect(loadDocPage('ghost', tmpDir, manifestPath)).toBeNull()
  })

  it('derives title from filename when no manifest title and no frontmatter title', () => {
    writeManifest([{ slug: 'multi-gateway-pool' }])
    writeDoc('multi-gateway-pool.md', 'body')

    const page = loadDocPage('multi-gateway-pool', tmpDir, manifestPath)
    expect(page?.title).toBe('multi gateway pool')
  })
})

describe('scanDocsTree', () => {
  it('builds tree separating root pages and folders in manifest order', () => {
    writeManifest([
      { slug: 'root-a', title: 'Root A' },
      { slug: 'plans/p1', title: 'P1' },
      { slug: 'plans/p2', title: 'P2' },
    ])
    writeDoc('root-a.md', '# Root A')
    writeDoc('plans/p1.md', '# P1')
    writeDoc('plans/p2.md', '# P2')

    const tree = scanDocsTree(tmpDir, manifestPath)
    expect(tree.rootPages.map((p) => p.slug)).toEqual(['root-a'])
    expect(tree.folders).toHaveLength(1)
    expect(tree.folders[0]!.name).toBe('plans')
    expect(tree.folders[0]!.pages.map((p) => p.slug)).toEqual([
      'plans/p1',
      'plans/p2',
    ])
  })

  it('excludes pages not in manifest from tree', () => {
    writeManifest([{ slug: 'visible', title: 'Visible' }])
    writeDoc('visible.md', '# Visible')
    writeDoc('hidden.md', '# Hidden')

    const tree = scanDocsTree(tmpDir, manifestPath)
    expect(tree.rootPages.map((p) => p.slug)).toEqual(['visible'])
  })
})

describe('getAdjacentPages', () => {
  it('computes prev/next based on manifest order', () => {
    writeManifest([
      { slug: 'one', title: 'One' },
      { slug: 'two', title: 'Two' },
      { slug: 'three', title: 'Three' },
    ])
    writeDoc('one.md', '# One')
    writeDoc('two.md', '# Two')
    writeDoc('three.md', '# Three')

    expect(getAdjacentPages('one', tmpDir, manifestPath)).toEqual({
      prev: null,
      next: { slug: 'two', title: 'Two' },
    })
    expect(getAdjacentPages('two', tmpDir, manifestPath)).toEqual({
      prev: { slug: 'one', title: 'One' },
      next: { slug: 'three', title: 'Three' },
    })
    expect(getAdjacentPages('three', tmpDir, manifestPath)).toEqual({
      prev: { slug: 'two', title: 'Two' },
      next: null,
    })
  })

  it('returns both null for slug not in manifest', () => {
    writeManifest([{ slug: 'a', title: 'A' }])
    writeDoc('a.md', '# A')

    expect(getAdjacentPages('nonexistent', tmpDir, manifestPath)).toEqual({
      prev: null,
      next: null,
    })
  })
})
