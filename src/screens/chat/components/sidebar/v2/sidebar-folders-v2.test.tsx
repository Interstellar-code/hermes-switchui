// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FolderHeaderMenu,
  FolderPickerList,
  SidebarGroupToggleV2,
  folderColor,
  useFolderFormStore,
} from './sidebar-folders-v2'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'
import { useSessionsSelectionStore } from '@/stores/sessions-selection-store'

const {
  createProject,
  moveSessions,
  deleteProject,
  archiveProject,
  updateProject,
  addFolder,
  navigate,
  activeProfile,
  folderMap,
  projectsList,
} = vi.hoisted(() => {
  type FakeMap = {
    version: string
    projects: Array<Record<string, unknown>>
    sessions: Record<string, string>
  }
  const noList: unknown = null
  const emptyMap = (): FakeMap => ({ version: 'v', projects: [], sessions: {} })
  return {
    createProject: vi.fn(),
    moveSessions: vi.fn(),
    deleteProject: vi.fn(),
    archiveProject: vi.fn(),
    updateProject: vi.fn(),
    addFolder: vi.fn(),
    navigate: vi.fn(),
    activeProfile: { current: 'work' },
    folderMap: { current: emptyMap() },
    projectsList: { current: noList },
  }
})

const mutation = (fn: (...a: Array<unknown>) => unknown) => ({
  mutate: fn,
  mutateAsync: fn,
  isPending: false,
  error: null,
})

vi.mock('@/hooks/use-resolved-profile', () => ({
  useResolvedProfile: () => 'work',
}))
vi.mock('@/lib/projects-api', () => ({
  useCreateProject: () => ({
    mutateAsync: createProject,
    isPending: false,
    error: null,
  }),
  useBulkMoveSessions: () => ({ mutateAsync: moveSessions }),
  useSessionProjectMap: () => ({ data: folderMap.current }),
  useProjects: () => ({ data: projectsList.current }),
  useUpdateProject: () => mutation(updateProject),
  useAddProjectFolder: () => mutation(addFolder),
  useArchiveProject: () => mutation(archiveProject),
  useRestoreProject: () => mutation(vi.fn()),
  useDeleteProject: () => mutation(deleteProject),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/hooks/use-agent-profiles', () => ({
  useAgentProfiles: () => ({
    profiles: ['work', 'other'],
    activeProfile: activeProfile.current,
    isLoading: false,
  }),
}))
vi.mock('@/lib/boards-api', () => ({
  useBoards: () => ({
    data: { boards: [{ slug: 'ops', name: 'Ops' }], current: 'ops' },
  }),
}))
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function mount(map: Parameters<typeof SidebarGroupToggleV2>[0]['map'] = null) {
  act(() => root.render(<SidebarGroupToggleV2 profile="work" map={map} />))
}
const q = <T extends Element>(sel: string) => container.querySelector<T>(sel)
const byText = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  createProject.mockReset()
  moveSessions.mockReset()
  useSessionsFilterStore.getState().setGroupBy('date')
  useSessionsSelectionStore.getState().exit()
  useFolderFormStore.getState().hide()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SidebarGroupToggleV2', () => {
  it('switches DATE | PROJECT grouping', () => {
    mount()
    const project = byText('PROJECT')
    expect(byText('DATE').getAttribute('aria-checked')).toBe('true')
    act(() => project.click())
    expect(useSessionsFilterStore.getState().groupBy).toBe('project')
    expect(project.getAttribute('aria-checked')).toBe('true')
  })

  it('SELECT toggles select mode', () => {
    mount()
    act(() => byText('SELECT').click())
    expect(useSessionsSelectionStore.getState().active).toBe(true)
    act(() => byText('SELECT').click())
    expect(useSessionsSelectionStore.getState().active).toBe(false)
  })

  it('+ FOLDER opens the form; Enter creates with name + colour', async () => {
    createProject.mockResolvedValue({ project: { slug: 'alpha' } })
    mount()
    act(() => q<HTMLButtonElement>('button[aria-label="New folder"]')!.click())
    const input = q<HTMLInputElement>('input[aria-label="Folder name"]')!
    expect(document.activeElement).toBe(input)
    expect(container.textContent).toContain('Link a kanban board later')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!
      setter.call(input, '  Alpha  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      )
    })
    expect(createProject).toHaveBeenCalledWith({
      name: 'Alpha',
      color: '#22c55e',
    })
    expect(moveSessions).not.toHaveBeenCalled()
    expect(q('[data-testid="new-folder-form"]')).toBeNull()
  })

  it('"+ New folder…" from a Move menu moves the sessions once created', async () => {
    createProject.mockResolvedValue({ project: { slug: 'beta' } })
    mount()
    act(() => useFolderFormStore.getState().show(['s1', 's2']))
    const input = q<HTMLInputElement>('input[aria-label="Folder name"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'Beta')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    moveSessions.mockResolvedValue({ failed: [], inherited: [] })
    act(() => useSessionsSelectionStore.getState().setMany(['chat:s1'], true))
    await act(async () => byText('CREATE').click())
    expect(moveSessions).toHaveBeenCalledWith({
      sessionKeys: ['s1', 's2'],
      projectSlug: 'beta',
    })
    expect(useSessionsSelectionStore.getState().active).toBe(false)
  })

  it('Esc cancels the form', () => {
    mount()
    act(() => q<HTMLButtonElement>('button[aria-label="New folder"]')!.click())
    act(() => {
      q('input')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(q('[data-testid="new-folder-form"]')).toBeNull()
  })

  it('shows the empty state in project mode with no folders', () => {
    useSessionsFilterStore.getState().setGroupBy('project')
    mount({ version: 'v', projects: [], sessions: {} })
    expect(container.textContent).toContain('NO FOLDERS YET')
    act(() => byText('+ NEW FOLDER').click())
    expect(q('[data-testid="new-folder-form"]')).not.toBeNull()
  })
})

describe('FolderPickerList', () => {
  const projects = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    slug: `s${i}`,
    name: i === 3 ? 'Needle project' : `Folder ${i}`,
    icon: null,
    color: null,
    archived: false,
    board_slug: null,
  }))
  const noop = () => {}

  it('puts only project rows in a capped scroll area', () => {
    act(() =>
      root.render(
        <FolderPickerList
          projects={projects}
          onPick={noop}
          onRemove={noop}
          onNewFolder={noop}
        />,
      ),
    )
    const scroll = q<HTMLElement>('[data-testid="folder-picker-scroll"]')!
    expect(scroll.style.overflowY).toBe('auto')
    expect(scroll.querySelectorAll('button')).toHaveLength(12)
    expect(scroll.textContent).not.toContain('Remove from project')
    expect(container.textContent).toContain('Remove from project')
  })

  it('shows a filter past 8 folders that narrows by name', () => {
    act(() =>
      root.render(
        <FolderPickerList
          projects={projects}
          onPick={noop}
          onRemove={noop}
          onNewFolder={noop}
        />,
      ),
    )
    const input = q<HTMLInputElement>('input[aria-label="Filter folders"]')!
    expect(document.activeElement).toBe(input)
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, 'needle')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const rows = q('[data-testid="folder-picker-scroll"]')!.querySelectorAll(
      'button',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Needle project')
  })

  it('inherited folder: hides Remove from project and explains instead', () => {
    act(() =>
      root.render(
        <FolderPickerList
          projects={projects.slice(0, 3)}
          currentId="p1"
          inherited
          onPick={noop}
          onRemove={noop}
          onNewFolder={noop}
        />,
      ),
    )
    expect(container.textContent).not.toContain('Remove from project')
    expect(q('[data-testid="folder-inherited-hint"]')!.textContent).toContain(
      'inherited from an earlier session',
    )
  })

  it('no filter at 8 or fewer folders', () => {
    act(() =>
      root.render(
        <FolderPickerList
          projects={projects.slice(0, 8)}
          onPick={noop}
          onRemove={noop}
          onNewFolder={noop}
        />,
      ),
    )
    expect(q('input[aria-label="Filter folders"]')).toBeNull()
  })
})

describe('folderColor', () => {
  it('prefers project.color and is deterministic otherwise', () => {
    expect(folderColor('p1', '#123456')).toBe('#123456')
    expect(folderColor('p1', null)).toBe(folderColor('p1'))
  })
})

describe('FolderHeaderMenu', () => {
  const mapProject = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    slug: 'alpha',
    name: 'Alpha',
    icon: null,
    color: null,
    archived: false,
    board_slug: null,
    ...over,
  })
  const onClose = vi.fn()
  function openMenu() {
    act(() =>
      root.render(
        <FolderHeaderMenu
          projectId="p1"
          name="Alpha"
          archived={false}
          position={{ x: 10, y: 10 }}
          onClose={onClose}
          onRename={vi.fn()}
        />,
      ),
    )
  }
  const menuItem = (text: RegExp) =>
    [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      text.test(b.textContent),
    ) as HTMLButtonElement
  const dialog = () => document.querySelector('[role="dialog"]')

  beforeEach(() => {
    onClose.mockReset()
    deleteProject.mockReset()
    archiveProject.mockReset()
    updateProject.mockReset()
    projectsList.current = null
    folderMap.current = {
      version: 'v',
      projects: [mapProject()],
      sessions: { s1: 'p1', s2: 'p1', s3: 'other' },
    }
  })

  it('confirms delete with the session count, then deletes by project id', async () => {
    openMenu()
    act(() => menuItem(/Delete folder/).click())
    expect(dialog()!.textContent).toContain('Delete folder ‘Alpha’?')
    expect(dialog()!.textContent).toContain(
      'Its 2 sessions move to Unfiled — no sessions are deleted.',
    )
    expect(
      document.querySelector('[data-testid="folder-delete-warning"]'),
    ).toBeNull()
    expect(deleteProject).not.toHaveBeenCalled()
    const confirm = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete folder',
    )!
    await act(async () => confirm.click())
    // Live (non-archived) folder: backend 409s on delete, so archive first.
    expect(archiveProject).toHaveBeenCalledWith('p1')
    expect(deleteProject).toHaveBeenCalledWith('p1')
    expect(archiveProject.mock.invocationCallOrder[0]).toBeLessThan(
      deleteProject.mock.invocationCallOrder[0],
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('deletes an archived folder without re-archiving', async () => {
    act(() =>
      root.render(
        <FolderHeaderMenu
          projectId="p1"
          name="Alpha"
          archived
          position={{ x: 10, y: 10 }}
          onClose={onClose}
          onRename={vi.fn()}
        />,
      ),
    )
    act(() => menuItem(/Delete folder/).click())
    const confirm = [...dialog()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Delete folder',
    )!
    await act(async () => confirm.click())
    expect(archiveProject).not.toHaveBeenCalled()
    expect(deleteProject).toHaveBeenCalledWith('p1')
  })

  it('focuses Cancel first and Esc closes the confirm', () => {
    openMenu()
    act(() => menuItem(/Delete folder/).click())
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect(dialog()!.getAttribute('aria-modal')).toBe('true')
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalled()
    expect(deleteProject).not.toHaveBeenCalled()
  })

  it('warns when the project has a linked board', () => {
    folderMap.current.projects = [mapProject({ board_slug: 'kb' })]
    openMenu()
    act(() => menuItem(/Delete folder/).click())
    expect(
      document.querySelector('[data-testid="folder-delete-warning"]')!
        .textContent,
    ).toContain('linked board/paths')
  })

  it('warns when the project has filesystem folders', () => {
    projectsList.current = {
      projects: [
        { id: 'p1', board_slug: null, folder_count: 2, primary_path: '/x' },
      ],
    }
    openMenu()
    act(() => menuItem(/Delete folder/).click())
    expect(
      document.querySelector('[data-testid="folder-delete-warning"]'),
    ).not.toBeNull()
  })

  it('archives and recolours by id', () => {
    openMenu()
    act(() => menuItem(/Archive/).click())
    expect(archiveProject).toHaveBeenCalledWith('p1')
    act(() => menuItem(/Colour/).click())
    act(() =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Colour #3b82f6"]',
        )!
        .click(),
    )
    expect(updateProject).toHaveBeenCalledWith({
      idOrSlug: 'p1',
      input: { color: '#3b82f6' },
    })
  })

  describe('Make it a project', () => {
    const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) =>
      act(() => {
        const proto =
          el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
        el.dispatchEvent(
          new Event(el instanceof HTMLSelectElement ? 'change' : 'input', {
            bubbles: true,
          }),
        )
      })
    const form = () =>
      document.querySelector<HTMLFormElement>(
        '[data-testid="make-project-form"]',
      )
    const submit = () =>
      act(async () => {
        form()!.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        )
      })

    beforeEach(() => {
      addFolder.mockReset()
      navigate.mockReset()
      activeProfile.current = 'work'
      projectsList.current = { projects: [{ id: 'p1', folder_count: 0 }] }
    })

    it('name-only folder offers "Make it a project…", not settings', () => {
      openMenu()
      expect(menuItem(/Make it a project/)).toBeDefined()
      expect(menuItem(/Project settings/)).toBeUndefined()
    })

    it('linked folder offers "Project settings…" that opens its drawer', () => {
      folderMap.current.projects = [mapProject({ board_slug: 'kb' })]
      openMenu()
      expect(menuItem(/Make it a project/)).toBeUndefined()
      act(() => menuItem(/Project settings/).click())
      expect(navigate).toHaveBeenCalledWith({
        to: '/projects',
        search: { profile: 'work', project: 'p1' },
      })
      expect(onClose).toHaveBeenCalled()
    })

    it('needs a path or a board, and the path must be absolute', async () => {
      openMenu()
      act(() => menuItem(/Make it a project/).click())
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Folder path"]',
      )!
      expect(document.activeElement).toBe(input)
      await submit()
      expect(form()!.querySelector('[role="alert"]')!.textContent).toBe(
        'Add a folder path or pick a board.',
      )
      setValue(input, 'relative/dir')
      await submit()
      expect(form()!.querySelector('[role="alert"]')!.textContent).toContain(
        'absolute',
      )
      expect(addFolder).not.toHaveBeenCalled()
      expect(updateProject).not.toHaveBeenCalled()
    })

    it('submits the folder and board for this project, then closes', async () => {
      addFolder.mockResolvedValue({})
      updateProject.mockResolvedValue({})
      openMenu()
      act(() => menuItem(/Make it a project/).click())
      setValue(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Folder path"]',
        )!,
        ' /src/alpha ',
      )
      setValue(
        document.querySelector<HTMLSelectElement>(
          'select[aria-label="Kanban board"]',
        )!,
        'ops',
      )
      await submit()
      expect(addFolder).toHaveBeenCalledWith({
        idOrSlug: 'p1',
        input: { path: '/src/alpha', is_primary: true },
      })
      expect(updateProject).toHaveBeenCalledWith({
        idOrSlug: 'p1',
        input: { board_slug: 'ops' },
      })
      expect(onClose).toHaveBeenCalled()
    })

    it('shows a server error inline and stays open; Esc closes', async () => {
      addFolder.mockRejectedValue(new Error('folder path too broad'))
      openMenu()
      act(() => menuItem(/Make it a project/).click())
      setValue(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Folder path"]',
        )!,
        '/',
      )
      await submit()
      expect(form()!.querySelector('[role="alert"]')!.textContent).toBe(
        'folder path too broad',
      )
      expect(onClose).not.toHaveBeenCalled()
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
      expect(onClose).toHaveBeenCalled()
    })

    it('accepts home and drive paths, rejects relative ones', async () => {
      addFolder.mockResolvedValue({})
      for (const ok of ['~/repo', '~', 'C:\\repo', 'D:/x']) {
        addFolder.mockClear()
        onClose.mockReset()
        act(() => root.unmount())
        root = createRoot(container)
        openMenu()
        act(() => menuItem(/Make it a project/).click())
        setValue(
          document.querySelector<HTMLInputElement>(
            'input[aria-label="Folder path"]',
          )!,
          ok,
        )
        await submit()
        expect(addFolder).toHaveBeenCalledWith({
          idOrSlug: 'p1',
          input: { path: ok, is_primary: true },
        })
      }
    })

    it('hides the board picker when browsing a non-active profile', async () => {
      activeProfile.current = 'other'
      openMenu()
      act(() => menuItem(/Make it a project/).click())
      expect(
        document.querySelector('select[aria-label="Kanban board"]'),
      ).toBeNull()
      expect(
        document.querySelector('[data-testid="boards-active-only"]')!
          .textContent,
      ).toContain('active profile only')
      await submit()
      expect(form()!.querySelector('[role="alert"]')!.textContent).toBe(
        'Add a folder path.',
      )
    })

    it('"New chat here" runs the folder\'s new-chat action and closes', () => {
      const onNewChat = vi.fn()
      act(() =>
        root.render(
          <FolderHeaderMenu
            projectId="p1"
            name="Alpha"
            archived={false}
            position={{ x: 10, y: 10 }}
            onClose={onClose}
            onRename={vi.fn()}
            onNewChat={onNewChat}
          />,
        ),
      )
      act(() => menuItem(/New chat here/).click())
      expect(onNewChat).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalled()
    })
  })
})
