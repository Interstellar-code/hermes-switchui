// @vitest-environment jsdom
/**
 * Covers the inventory screen end to end against mocked payloads, including
 * the install shape this project actually ships with (provider defined inline
 * in the `model` block rather than in a `providers` map).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProvidersScreen } from './providers-screen'

vi.mock('@/lib/hermes-client', () => ({
  getEnv: vi.fn(async () => ({})),
  gatewayRestart: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

const CLAUDE_CONFIG = {
  config: {
    model: {
      provider: 'custom',
      base_url: 'https://interstellar-llm.example/v1',
      api_key: 'sk-inline',
      default: 'auto',
    },
  },
  providers: [],
  activeProvider: 'custom',
  activeModel: 'auto',
}

const MODELS = {
  models: [{ id: 'auto', provider: 'custom' }],
  configuredProviders: ['custom'],
}

const LOCAL = { providers: [{ id: 'ollama', online: false }] }

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response)
}

let fetchMock: ReturnType<typeof vi.fn>

function installFetch() {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/gateway-status')) {
      return jsonResponse({ capabilities: { config: true }, claudeUrl: '' })
    }
    if (
      url.startsWith('/api/claude-config') &&
      (init?.method ?? 'GET') === 'GET'
    ) {
      return jsonResponse(CLAUDE_CONFIG)
    }
    if (url.startsWith('/api/claude-config')) {
      return jsonResponse({ ok: true, message: 'saved' })
    }
    if (url.startsWith('/api/models')) return jsonResponse(MODELS)
    if (url.startsWith('/api/local-providers')) return jsonResponse(LOCAL)
    return jsonResponse({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ProvidersScreen />
    </QueryClientProvider>,
  )
}

function configWrites() {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).startsWith('/api/claude-config') &&
      (init?.method ?? 'GET') !== 'GET',
  )
}

beforeEach(() => {
  installFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ProvidersScreen', () => {
  it('renders a card per provider, including the catalog shelf', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelectorAll('.pv-card').length).toBeGreaterThan(20),
    )
    // "Custom" appears twice by design: the card and the Active header stat.
    await waitFor(() => expect(screen.getAllByText('Custom')).toHaveLength(2))
    expect(screen.getByText('Anthropic')).toBeTruthy()
  })

  it('surfaces the inline-model provider as active with its endpoint', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    const card = container.querySelector('.pv-card') as HTMLElement
    expect(within(card).getByText('Custom')).toBeTruthy()
    expect(within(card).getByText('Active')).toBeTruthy()
    expect(
      within(card).getByText('https://interstellar-llm.example/v1'),
    ).toBeTruthy()
    // Credential lives in config.yaml, not .env — the card must say so.
    expect(within(card).getByText('config.yaml')).toBeTruthy()
  })

  it('filters by status and reports the visible count', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )
    const total = container.querySelectorAll('.pv-card').length

    fireEvent.click(screen.getByRole('button', { name: /^Active/ }))
    await waitFor(() =>
      expect(container.querySelectorAll('.pv-card')).toHaveLength(1),
    )
    expect(container.querySelectorAll('.pv-card').length).toBeLessThan(total)
  })

  it('filters by search across id, name and endpoint', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.change(screen.getByLabelText('Search providers'), {
      target: { value: 'interstellar-llm' },
    })
    await waitFor(() =>
      expect(container.querySelectorAll('.pv-card')).toHaveLength(1),
    )
  })

  it('switches to the table view', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await waitFor(() =>
      expect(container.querySelector('.pv-table')).toBeTruthy(),
    )
    expect(container.querySelector('.pv-card')).toBeNull()
  })

  it('collapses and expands the filter rail', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse filters' }))
    await waitFor(() =>
      expect(container.querySelector('.pv-filter.is-collapsed')).toBeTruthy(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand filters' }))
    await waitFor(() =>
      expect(container.querySelector('.pv-filter.is-collapsed')).toBeNull(),
    )
  })

  it('writes nothing while merely browsing', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: /^Available/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }))
    await waitFor(() =>
      expect(container.querySelector('.pv-table')).toBeTruthy(),
    )

    expect(configWrites()).toHaveLength(0)
  })
})

describe('provider detail drawer', () => {
  it('opens inside the screen subtree, not through a portal', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)

    // Being a descendant of [data-screen] is what makes the scoped stylesheet
    // apply — a portalled drawer would render unstyled.
    const drawer = await waitFor(() => {
      const found = container.querySelector(
        '[data-screen="providers"] .pv-drawer.open',
      )
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    expect(within(drawer).getByRole('heading', { name: 'Custom' })).toBeTruthy()
  })

  it('shows the four tabs and switches between them', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('.pv-drawer.open')).toBeTruthy(),
    )

    for (const tab of ['Overview', 'Models', 'Credentials', 'Config']) {
      expect(
        screen.getByRole('button', { name: new RegExp(`^${tab}`) }),
      ).toBeTruthy()
    }

    fireEvent.click(screen.getByRole('button', { name: /^Config/ }))
    // The inline shape must be reported as such, not as a providers: entry.
    await waitFor(() =>
      expect(screen.getByText(/provider: custom/)).toBeTruthy(),
    )
  })

  it('explains that an inline credential is not in .env', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('.pv-drawer.open')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: /^Credentials/ }))
    expect(await screen.findByText(/stored inline in/)).toBeTruthy()
  })

  it('closes on Escape', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('.pv-drawer.open')).toBeTruthy(),
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(container.querySelector('.pv-drawer.open')).toBeNull(),
    )
  })

  it('removes a provider through the DELETE verb', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )
    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    await waitFor(() =>
      expect(container.querySelector('.pv-drawer.open')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove provider' }),
    )

    await waitFor(() => expect(configWrites()).toHaveLength(1))
    const [, init] = configWrites()[0]
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: 'custom',
      removeKey: false,
    })
  })
})

describe('provider wizard', () => {
  it('saves a catalog provider with the shape the gateway reads', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Anthropic/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add provider' }))
    const keyField = await screen.findByLabelText('API key')
    fireEvent.change(keyField, { target: { value: 'sk-ant-test' } })

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    const preview = await screen.findByText(/providers:/)
    expect(preview.textContent).toContain('anthropic')
    expect(preview.textContent).toContain('key_env: ANTHROPIC_API_KEY')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(configWrites()).toHaveLength(1))
    const [, init] = configWrites()[0]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({
      config: {
        providers: {
          // No `type:` — the gateway reads no such key off a providers entry.
          anthropic: {
            base_url: 'https://api.anthropic.com/v1',
            key_env: 'ANTHROPIC_API_KEY',
          },
        },
      },
      env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
    })
  })

  it('edits the inline provider in place instead of adding a providers entry', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    // The active inline provider is the first card → drawer → Edit.
    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByText(/defined inline/)

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => expect(configWrites()).toHaveLength(1))
    const body = JSON.parse(String(configWrites()[0][1]?.body)) as {
      config: Record<string, unknown>
    }
    expect(body.config.model).toMatchObject({ provider: 'custom' })
    expect(body.config.providers).toBeUndefined()
  })

  it('does not write when the wizard is cancelled', async () => {
    const { container } = renderScreen()
    await waitFor(() =>
      expect(container.querySelector('.pv-card')).toBeTruthy(),
    )

    fireEvent.click(container.querySelector('.pv-card') as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(configWrites()).toHaveLength(0)
  })
})
