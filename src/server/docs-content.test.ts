import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getAllPages,
  scanDocsTree,
  loadDocPage,
  getAdjacentPages,
} from './docs-content'

let tmpDir: string

function write(rel: string, body: string) {
  const full = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, body, 'utf-8')
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-content-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('docs-content', () => {
  it('only returns pages with published: true', () => {
    write(
      'a.md',
      '---\npublished: true\ntitle: A\norder: 1\n---\n# A\nbody',
    )
    write('b.md', '---\ntitle: B\n---\n# B unpublished')
    write('c.md', '# Plain no frontmatter')

    const pages = getAllPages(tmpDir)
    expect(pages.map((p) => p.slug)).toEqual(['a'])
  })

  it('sorts by frontmatter order then slug', () => {
    write('z.md', '---\npublished: true\norder: 2\n---\n')
    write('a.md', '---\npublished: true\norder: 5\n---\n')
    write('m.md', '---\npublished: true\norder: 2\n---\n')

    const pages = getAllPages(tmpDir)
    expect(pages.map((p) => p.slug)).toEqual(['m', 'z', 'a'])
  })

  it('derives title from filename when frontmatter title missing', () => {
    write('multi-gateway-pool.md', '---\npublished: true\n---\nbody')
    const page = loadDocPage('multi-gateway-pool', tmpDir)
    expect(page?.title).toBe('multi gateway pool')
  })

  it('builds tree separating root pages and folders', () => {
    write('root-a.md', '---\npublished: true\ntitle: Root A\n---\n')
    write('plans/p1.md', '---\npublished: true\ntitle: P1\n---\n')
    write('plans/p2.md', '---\npublished: true\ntitle: P2\n---\n')
    write('plans/draft.md', '---\ntitle: Draft\n---\n')

    const tree = scanDocsTree(tmpDir)
    expect(tree.rootPages.map((p) => p.slug)).toEqual(['root-a'])
    expect(tree.folders).toHaveLength(1)
    expect(tree.folders[0]!.name).toBe('plans')
    expect(tree.folders[0]!.pages.map((p) => p.slug)).toEqual([
      'plans/p1',
      'plans/p2',
    ])
  })

  it('computes adjacent pages in flat order', () => {
    write('one.md', '---\npublished: true\norder: 1\n---\n')
    write('two.md', '---\npublished: true\norder: 2\n---\n')
    write('three.md', '---\npublished: true\norder: 3\n---\n')

    expect(getAdjacentPages('one', tmpDir)).toEqual({
      prev: null,
      next: { slug: 'two', title: 'two' },
    })
    expect(getAdjacentPages('two', tmpDir)).toEqual({
      prev: { slug: 'one', title: 'one' },
      next: { slug: 'three', title: 'three' },
    })
    expect(getAdjacentPages('three', tmpDir)).toEqual({
      prev: { slug: 'two', title: 'two' },
      next: null,
    })
  })

  it('returns null for unpublished slug', () => {
    write('a.md', '---\ntitle: A\n---\n')
    expect(loadDocPage('a', tmpDir)).toBeNull()
  })
})
