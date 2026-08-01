import { describe, expect, it } from 'vitest'
import { mergeDesktopUpdateState } from './update-center'
import type { UpdateStatus } from './update-center'

const baseStatus: UpdateStatus = {
  ok: true,
  checkedAt: 1,
  updateAvailable: true,
  products: {
    workspace: {
      id: 'workspace',
      label: 'Hermes Switch UI',
      installKind: 'git',
      version: '1.0.0',
      path: null,
      repoPath: null,
      branch: 'main',
      currentHead: 'a',
      latestHead: 'b',
      updateAvailable: true,
      canUpdate: true,
      state: 'available',
      reason: null,
      updateMode: 'git-ff',
    },
    agent: {
      id: 'agent',
      label: 'Hermes Agent',
      installKind: 'git',
      version: '2.0.0',
      path: null,
      repoPath: null,
      branch: null,
      currentHead: null,
      latestHead: null,
      updateAvailable: true,
      canUpdate: false,
      state: 'blocked',
      reason: 'manual',
      updateMode: 'manual',
    },
  },
}

describe('desktop update status', () => {
  it('replaces only workspace status and preserves remote Agent status', () => {
    const result = mergeDesktopUpdateState(baseStatus, {
      checking: false,
      available: false,
      downloaded: false,
      error: null,
      version: '1.0.0',
      latestVersion: null,
    })
    expect(result.products.workspace.installKind).toBe('desktop')
    expect(result.products.agent).toEqual(baseStatus.products.agent)
    expect(result.updateAvailable).toBe(true)
  })

  it('marks a downloaded desktop update ready to install', () => {
    const result = mergeDesktopUpdateState(baseStatus, {
      checking: false,
      available: true,
      downloaded: true,
      error: null,
      version: '1.0.0',
      latestVersion: '1.1.0',
    })
    expect(result.products.workspace.updateMode).toBe('desktop-install-ready')
    expect(result.products.workspace.targetVersion).toBe('1.1.0')
  })
})
