// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionExecution from './section-execution'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockFetchAgentCwd } = vi.hoisted(() => ({
  mockFetchAgentCwd: vi.fn(),
}))

vi.mock('@/screens/chat/components/chat-composer-services', () => ({
  fetchAgentCwd: mockFetchAgentCwd,
  agentCwdSourceLabel: (source: string) => `label:${source}`,
  agentCwdSourceDetail: () => 'detail',
}))

vi.mock('@/components/hermes-docs-link', () => ({
  HermesDocsLink: ({ label }: { label?: string }) => <span>{label ?? 'Docs'}</span>,
}))

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed(patch)
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SectionExecution />
    </QueryClientProvider>,
  )
}

const BASE_CWD_STATUS = {
  ok: true,
  resolved: {
    path: '/home/user',
    source: 'home-sentinel',
    backend: 'local',
    profile: 'default',
    warnings: [] as Array<string>,
  },
  activeProfile: 'default',
  launch: { multiplex: false, launchProfile: 'default', reachable: true },
  configuredCwd: '.',
  hasTerminalBlock: true,
  editable: true,
  suggestedCwd: '/home/user',
  homeDir: '/home/user',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('SectionExecution', () => {
  it('shows the read-only resolved agent cwd from /api/agent-cwd instead of a second editor', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'local' })

    renderSection()

    await waitFor(() => expect(screen.getByText('/home/user')).toBeTruthy())
    // No path input for cwd anywhere in this section.
    expect(screen.queryByDisplayValue('/home/user')).toBeNull()
  })

  it('surfaces resolver warnings (e.g. profile inheritance gap) inline', async () => {
    mockFetchAgentCwd.mockResolvedValue({
      ...BASE_CWD_STATUS,
      hasTerminalBlock: false,
      resolved: {
        ...BASE_CWD_STATUS.resolved,
        warnings: ['Profile "default" has no `terminal:` block.'],
      },
    })
    loadDraft({ 'config.terminal.backend': 'local' })

    renderSection()

    await waitFor(() =>
      expect(screen.getByText(/has no `terminal:` block/)).toBeTruthy(),
    )
  })

  it('round-trips terminal.timeout through the settings store', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'local', 'config.terminal.timeout': 180 })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    const numberInputs = screen.getAllByRole<HTMLInputElement>('spinbutton')
    const timeoutInput = numberInputs.find((el) => el.value === '180')
    expect(timeoutInput).toBeTruthy()
    fireEvent.change(timeoutInput!, { target: { value: '300' } })

    expect(useSettingsStore.getState().draft['config.terminal.timeout']).toBe(300)
  })

  it('only supports local and docker in the backend picker, warning for other backends', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'modal' })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    expect(screen.getByText(/not editable from this picker/)).toBeTruthy()
    expect(screen.getByText('modal')).toBeTruthy()
  })

  it('hides Docker advanced settings when backend is local', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'local' })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    expect(screen.queryByText('Advanced Docker settings')).toBeNull()
  })

  it('shows Docker advanced settings, including the filesystem-view warning, when backend is docker', async () => {
    mockFetchAgentCwd.mockResolvedValue({
      ...BASE_CWD_STATUS,
      resolved: { ...BASE_CWD_STATUS.resolved, backend: 'docker' },
    })
    loadDraft({
      'config.terminal.backend': 'docker',
      'config.terminal.docker_mount_cwd_to_workspace': false,
    })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    expect(screen.getByText('Advanced Docker settings')).toBeTruthy()
    fireEvent.click(screen.getByText('Advanced Docker settings'))
    expect(screen.getByText(/agent's filesystem view becomes the bind-mounted host directory/)).toBeTruthy()
  })

  it('flags persistent_shell as a no-op on the local backend', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'local', 'config.terminal.persistent_shell': true })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    expect(screen.getByText(/no-op on the local backend/)).toBeTruthy()
  })

  it('round-trips code_execution.mode', async () => {
    mockFetchAgentCwd.mockResolvedValue(BASE_CWD_STATUS)
    loadDraft({ 'config.terminal.backend': 'local', 'config.code_execution.mode': 'project' })

    renderSection()
    await waitFor(() => expect(mockFetchAgentCwd).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('radio', { name: 'Strict' }))
    expect(useSettingsStore.getState().draft['config.code_execution.mode']).toBe('strict')
  })
})
