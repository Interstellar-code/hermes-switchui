// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectActivityTab, ProjectCard } from './projects-screen'
import type { Project, ProjectActivityItem } from '@/lib/projects-types'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const { mockUseProjectActivity } = vi.hoisted(() => ({
  mockUseProjectActivity: vi.fn(),
}))
vi.mock('@/lib/projects-api', () => ({
  useProjectActivity: (...args: Array<unknown>) =>
    mockUseProjectActivity(...args),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p_abc123',
    slug: 'switchui',
    name: 'SwitchUI',
    description: null,
    icon: null,
    color: '#00ff41',
    board_slug: null,
    primary_path: '/repo/switchui',
    archived: false,
    created_at: 1700000000,
    folders: [],
    bound_board: null,
    folder_count: 3,
    task_count: 12,
    open_task_count: 4,
    task_status_counts: {},
    session_count: 0,
    last_task_activity_at: null,
    last_session_activity_at: null,
    last_activity_at: Math.floor(Date.now() / 1000) - 120,
    is_active: true,
    ...overrides,
  }
}

describe('ProjectCard', () => {
  it('renders v2 stats and the bound board name', () => {
    const project = baseProject({
      bound_board: {
        slug: 'agent-work',
        name: 'Agent Work',
        color: '#00ff41',
        description: '',
        icon: '',
        archived: false,
      },
    })
    render(<ProjectCard project={project} isActive={false} onOpen={() => {}} />)

    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('4 open')).toBeTruthy()
    expect(screen.getByText('Agent Work')).toBeTruthy()
    expect(screen.getByText(/Last active/)).toBeTruthy()
  })

  it('falls back to the board_slug text when bound_board is null', () => {
    const project = baseProject({
      bound_board: null,
      board_slug: 'legacy-board',
    })
    render(<ProjectCard project={project} isActive={false} onOpen={() => {}} />)

    expect(screen.getByText('legacy-board')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /legacy-board/ })).toBeNull()
  })
})

function taskItem(
  overrides: Partial<ProjectActivityItem> = {},
): ProjectActivityItem {
  return {
    kind: 'task',
    id: 't_1',
    occurred_at: Math.floor(Date.now() / 1000) - 60,
    event_kind: 'created',
    board_slug: 'agent-work',
    title: 'Fix the bug',
    status: 'in_progress',
    assignee: null,
    created_at: Math.floor(Date.now() / 1000) - 60,
    ...overrides,
  } as ProjectActivityItem
}

describe('ProjectActivityTab', () => {
  const project = baseProject()

  it('shows the empty state when there are no items', () => {
    mockUseProjectActivity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { project_id: project.id, items: [], next_cursor: null },
    })
    render(<ProjectActivityTab project={project} />)
    expect(screen.getByText('No recent activity')).toBeTruthy()
  })

  it('renders a task item title and status', () => {
    mockUseProjectActivity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        project_id: project.id,
        items: [taskItem({ title: 'Fix the bug', status: 'in_progress' })],
        next_cursor: null,
      },
    })
    render(<ProjectActivityTab project={project} />)
    expect(screen.getByText('Fix the bug')).toBeTruthy()
    expect(screen.getByText('in_progress')).toBeTruthy()
  })

  it('renders without crashing when a next_cursor is present, and filters non-task items', () => {
    mockUseProjectActivity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        project_id: project.id,
        items: [
          taskItem({ id: 't_2', title: 'Only task shown' }),
          {
            kind: 'session',
            id: 's_1',
            occurred_at: Math.floor(Date.now() / 1000),
            title: 'A chat session',
            preview: '...',
            source: 'claude',
            model: 'sonnet',
            message_count: 3,
            cwd: '/repo',
          },
        ],
        next_cursor: 'cursor-abc',
      },
    })
    render(<ProjectActivityTab project={project} />)
    expect(screen.getByText('Only task shown')).toBeTruthy()
    expect(screen.queryByText('A chat session')).toBeNull()
  })
})
