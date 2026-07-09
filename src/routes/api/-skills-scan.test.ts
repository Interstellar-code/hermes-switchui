import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanSkillRoot } from './skills'

describe('scanSkillRoot', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'skills-scan-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds root-level skills (no category wrapper)', async () => {
    await mkdir(path.join(root, 'plugin-authoring'))
    await writeFile(
      path.join(root, 'plugin-authoring', 'SKILL.md'),
      '---\nname: plugin-authoring\n---\nbody',
    )
    const found = await scanSkillRoot(root)
    expect(found.has('plugin-authoring')).toBe(true)
  })

  it('finds skills nested 3+ levels deep', async () => {
    await mkdir(path.join(root, 'mlops', 'evaluation', 'lm-evaluation-harness'), { recursive: true })
    await writeFile(
      path.join(root, 'mlops', 'evaluation', 'lm-evaluation-harness', 'SKILL.md'),
      '---\nname: lm-evaluation-harness\n---\nbody',
    )
    const found = await scanSkillRoot(root)
    expect(found.has('lm-evaluation-harness')).toBe(true)
  })

  it('finds standard 2-level skills (regression check)', async () => {
    await mkdir(path.join(root, 'coding', 'gitflow'), { recursive: true })
    await writeFile(
      path.join(root, 'coding', 'gitflow', 'SKILL.md'),
      '---\nname: gitflow\n---\nbody',
    )
    const found = await scanSkillRoot(root)
    expect(found.has('gitflow')).toBe(true)
  })

  it('skips support subdirectories under a real skill', async () => {
    await mkdir(path.join(root, 'comfyui', 'scripts'), { recursive: true })
    await writeFile(path.join(root, 'comfyui', 'SKILL.md'), '---\nname: comfyui\n---\nbody')
    await writeFile(
      path.join(root, 'comfyui', 'scripts', 'SKILL.md'),
      '---\nname: NOT-A-SKILL\n---\nbody',
    )
    const found = await scanSkillRoot(root)
    expect(found.has('comfyui')).toBe(true)
    expect(found.has('scripts')).toBe(false)
  })

  it('excludes venv / node_modules / __pycache__', async () => {
    for (const ex of ['venv', 'node_modules', '__pycache__']) {
      await mkdir(path.join(root, ex, 'sneaky-skill'), { recursive: true })
      await writeFile(path.join(root, ex, 'sneaky-skill', 'SKILL.md'), 'body')
    }
    const found = await scanSkillRoot(root)
    expect(found.size).toBe(0)
  })
})
