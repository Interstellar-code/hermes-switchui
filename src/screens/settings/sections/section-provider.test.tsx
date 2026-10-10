// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsSaver } from '../lib/saver'
import SectionProvider, { parseLegacyFallback } from './section-provider'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const {
  mockNavigate,
  mockModelInfo,
  mockModelOptions,
  mockSetModelAssignment,
  mockPutConfig,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockModelInfo: vi.fn(),
  mockModelOptions: vi.fn(),
  mockSetModelAssignment: vi.fn(),
  mockPutConfig: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }))
vi.mock('@/lib/hermes-client', () => ({
  modelInfo: mockModelInfo,
  modelOptions: mockModelOptions,
  setModelAssignment: mockSetModelAssignment,
  putConfig: mockPutConfig,
}))
vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed(patch)
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SectionProvider />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockModelInfo.mockResolvedValue({
    provider: 'anthropic',
    model: 'claude-main',
    capabilities: {},
  })
  mockModelOptions.mockResolvedValue({
    providers: [
      {
        slug: 'anthropic',
        name: 'Anthropic',
        models: ['claude-main', 'claude-fallback'],
      },
      { slug: 'openai', name: 'OpenAI', models: ['gpt-x'] },
    ],
  })
  mockSetModelAssignment.mockResolvedValue({})
  mockPutConfig.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('parseLegacyFallback', () => {
  it('splits provider/model on the first slash', () => {
    expect(parseLegacyFallback('x/y')).toEqual({ provider: 'x', model: 'y' })
    expect(parseLegacyFallback(' openai/gpt-4/o ')).toEqual({
      provider: 'openai',
      model: 'gpt-4/o',
    })
  })

  it('treats a slash-less string as a bare model', () => {
    expect(parseLegacyFallback('claude-3-haiku')).toEqual({
      provider: '',
      model: 'claude-3-haiku',
    })
  })
})

describe('SectionProvider fallback chain', () => {
  it('saving an edited chain PUTs fallback_providers as a real list of {provider, model} dicts', async () => {
    loadDraft({})
    renderSection()
    await waitFor(() => expect(mockModelOptions).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '+ Add fallback' }))
    fireEvent.change(screen.getByLabelText('Fallback 1 provider'), {
      target: { value: 'anthropic' },
    })
    fireEvent.change(screen.getByLabelText('Fallback 1 model'), {
      target: { value: 'claude-fallback' },
    })

    // Draft carries the whole array at the dotted key…
    expect(
      useSettingsStore.getState().draft['config.fallback_providers'],
    ).toEqual([{ provider: 'anthropic', model: 'claude-fallback' }])
    expect(
      useSettingsStore.getState().dirty.has('config.fallback_providers'),
    ).toBe(true)

    // …and the saver turns that into a nested PUT body, not a flattened
    // `fallback_providers.0.provider` key explosion the agent would ignore.
    await useSettingsStore.getState().save(settingsSaver)

    expect(mockPutConfig).toHaveBeenCalledTimes(1)
    const body = mockPutConfig.mock.calls[0][0]
    expect(body.config).toEqual({
      fallback_providers: [{ provider: 'anthropic', model: 'claude-fallback' }],
    })
    expect(Array.isArray(body.config?.fallback_providers)).toBe(true)
  })

  it('a legacy fallback_model string pre-fills one row, shows the ignored note, and is never written', async () => {
    loadDraft({ 'config.fallback_model': 'x/y' })
    renderSection()
    await waitFor(() => expect(mockModelOptions).toHaveBeenCalled())

    const providerSelect = screen.getByLabelText<HTMLSelectElement>(
      'Fallback 1 provider',
    )
    const modelInput =
      screen.getByLabelText<HTMLInputElement>('Fallback 1 model')
    expect(providerSelect.value).toBe('x')
    expect(modelInput.value).toBe('y')
    expect(screen.getByText(/is ignored by the agent/)).toBeTruthy()

    // The pre-fill is display-only: nothing goes dirty until the user edits.
    expect(useSettingsStore.getState().dirty.size).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '+ Add fallback' }))
    fireEvent.change(screen.getByLabelText('Fallback 2 provider'), {
      target: { value: 'openai' },
    })
    fireEvent.change(screen.getByLabelText('Fallback 2 model'), {
      target: { value: 'gpt-x' },
    })
    await useSettingsStore.getState().save(settingsSaver)

    const body = mockPutConfig.mock.calls[0][0]
    expect(body.config).toEqual({
      fallback_providers: [
        { provider: 'x', model: 'y' },
        { provider: 'openai', model: 'gpt-x' },
      ],
    })
    // fallback_model keeps its committed value and is never in a save body.
    expect('fallback_model' in body.config).toBe(false)
    expect(useSettingsStore.getState().draft['config.fallback_model']).toBe(
      'x/y',
    )
    expect(useSettingsStore.getState().committed['config.fallback_model']).toBe(
      'x/y',
    )
    expect(useSettingsStore.getState().dirty.has('config.fallback_model')).toBe(
      false,
    )
  })

  it('reorders and removes rows, writing the whole chain each time', async () => {
    loadDraft({
      'config.fallback_providers': [
        { provider: 'a', model: 'one' },
        { provider: 'b', model: 'two' },
      ],
    })
    renderSection()
    await waitFor(() => expect(mockModelOptions).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Move fallback 2 up' }))
    expect(
      useSettingsStore.getState().draft['config.fallback_providers'],
    ).toEqual([
      { provider: 'b', model: 'two' },
      { provider: 'a', model: 'one' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Remove fallback 1' }))
    expect(
      useSettingsStore.getState().draft['config.fallback_providers'],
    ).toEqual([{ provider: 'a', model: 'one' }])
  })

  it('shows an empty state when no chain and no legacy fallback_model exist', async () => {
    loadDraft({})
    renderSection()
    await waitFor(() => expect(mockModelOptions).toHaveBeenCalled())

    expect(screen.getByText(/No fallback providers configured/i)).toBeTruthy()
    expect(screen.queryByLabelText('Fallback 1 provider')).toBeNull()
  })
})
