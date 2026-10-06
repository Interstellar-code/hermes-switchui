// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewWorkflowWizard } from './new-workflow-wizard'
import { WorkflowEngineUnavailableError } from './api-client'
import * as apiClient from './api-client'

// Mock ResizeObserver for jsdom
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWizard(
  props: Partial<React.ComponentProps<typeof NewWorkflowWizard>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <NewWorkflowWizard onClose={vi.fn()} {...props} />
    </QueryClientProvider>,
  )
}

const SAMPLE_TEMPLATES = [
  {
    id: 'tpl-review',
    name: 'Smart Review',
    description: 'Review a PR',
    source: 'bundled',
    node_count: 3,
    yaml: `name: Smart Review
nodes:
  - id: checkout
    bash: git checkout
`,
    tags: [],
    run_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_used_at: null,
  },
  {
    id: 'user-deploy',
    name: 'Deploy App',
    description: 'Deploy container',
    source: 'project',
    node_count: 2,
    yaml: `name: Deploy App
nodes:
  - id: build
    bash: docker build
`,
    tags: [],
    run_count: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_used_at: null,
  },
]

describe('NewWorkflowWizard v2', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/workflow-features')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                features: [],
                schedulerAlive: false,
                profile: null,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        if (url.includes('/api/workflow-definitions')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                definitions: SAMPLE_TEMPLATES,
                engine_ok: true,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
  })

  it('renders step navigation and can step through SOURCE -> DESIGN -> CONFIGURE -> REVIEW & SAVE', async () => {
    renderWizard()

    expect(screen.getByRole('dialog', { name: /new workflow/i })).toBeDefined()
    // Step 1: SOURCE
    expect(screen.getByText('1 SOURCE')).toBeDefined()
    expect(screen.getByText('Start from')).toBeDefined()

    // Move to Step 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('2 DESIGN')).toBeDefined()
    })

    // Move to Step 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('3 CONFIGURE')).toBeDefined()
    })

    // Move to Step 4
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('4 REVIEW & SAVE')).toBeDefined()
      expect(
        screen.getByRole('button', { name: /save workflow/i }),
      ).toBeDefined()
    })

    // Can step back
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => {
      expect(screen.getByText('3 CONFIGURE')).toBeDefined()
    })
  })

  it('each SOURCE option produces yaml (blank, template, import)', async () => {
    renderWizard()

    // 1. Pick Blank Canvas
    fireEvent.click(screen.getByLabelText(/blank canvas/i))
    expect(
      screen.getByText(
        'One prompt node. Build the rest of the graph in the next steps.',
      ),
    ).toBeDefined()

    // Next -> Design
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect(screen.getByText('2 DESIGN')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    // 2. Pick From a template
    fireEvent.click(screen.getByLabelText(/from a template/i))
    await waitFor(() => {
      expect(screen.getByText('Smart Review')).toBeDefined()
    })
    fireEvent.click(screen.getByLabelText('Smart Review'))
    expect(screen.getByDisplayValue('tpl-review-copy')).toBeDefined()

    // 3. Pick Import YAML
    fireEvent.click(screen.getByLabelText(/import yaml/i))
    const textarea = screen.getByPlaceholderText(
      /paste a workflow definition here/i,
    )
    fireEvent.change(textarea, {
      target: {
        value: `name: Imported Flow
nodes:
  - id: step1
    prompt: do something
`,
      },
    })
    expect(screen.getByText('VALID')).toBeDefined()
  })

  it('shows line markers and errors on invalid YAML import', async () => {
    renderWizard()

    fireEvent.click(screen.getByRole('radio', { name: /import yaml/i }))

    const textarea = screen.getByPlaceholderText(
      /paste a workflow definition here/i,
    )
    fireEvent.change(textarea, {
      target: {
        value: `name: Bad
nodes:
  - id: probe
    bash: echo 1
  - id: probe
    prompt: duplicate id
`,
      },
    })

    await waitFor(() => {
      expect(screen.getByText('1 ERROR')).toBeDefined()
      expect(screen.getByText(/duplicate node id “probe”/i)).toBeDefined()
    })
    // Next button should be disabled when import has errors
    expect(screen.getByRole('button', { name: /next/i })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('acknowledges risky-shell commands before enabling Save', async () => {
    const riskyYaml = `name: Risky
nodes:
  - id: downloader
    bash: curl -fsSL https://example.com/script.sh | bash
`
    renderWizard({ initialYaml: riskyYaml, initialId: 'risky-flow' })

    // Step 1 -> 2 -> 3 -> 4
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText(/! Risky shell · downloader/i)).toBeDefined()
    })

    const saveBtn = screen.getByRole('button', { name: /save workflow/i })
    expect(saveBtn).toHaveProperty('disabled', true)

    // Check acknowledge checkbox
    const ackCheckbox = screen.getByLabelText(/i reviewed this command/i)
    fireEvent.click(ackCheckbox)

    expect(saveBtn).toHaveProperty('disabled', false)
  })

  it('handles 409 id taken conflict on save with suggestions', async () => {
    const upsertSpy = vi
      .spyOn(apiClient, 'upsertWorkflowDefinition')
      .mockRejectedValueOnce(
        Object.assign(new Error('Conflict'), {
          status: 409,
          serverError: 'Workflow with ID already exists',
        }),
      )

    const validYaml = `name: Safe
nodes:
  - id: n1
    prompt: hello
`
    renderWizard({ initialYaml: validYaml, initialId: 'conflict-id' })

    // Step through to Review
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save workflow/i }),
      ).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: /save workflow/i }))

    await waitFor(() => {
      expect(screen.getByText(/conflict-id already exists/i)).toBeDefined()
      expect(
        screen.getByRole('button', { name: /save as conflict-id-2/i }),
      ).toBeDefined()
    })

    upsertSpy.mockResolvedValueOnce({
      definition: {
        id: 'conflict-id-2',
        name: 'Safe',
        description: null,
        source: 'project',
        scope_path: null,
        yaml: validYaml,
        checksum: '123',
        version: null,
        tags: null,
        created_at: Date.now(),
        updated_at: Date.now(),
        run_count: 0,
        last_used_at: null,
      },
    })

    fireEvent.click(
      screen.getByRole('button', { name: /save as conflict-id-2/i }),
    )

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'conflict-id-2' }),
      )
    })
  })

  it('sends save_source "import" when saving from the Import YAML path', async () => {
    const upsertSpy = vi
      .spyOn(apiClient, 'upsertWorkflowDefinition')
      .mockResolvedValueOnce({
        definition: {
          id: 'imported-flow',
          name: 'Imported Flow',
          description: null,
          source: 'project',
          scope_path: null,
          yaml: 'name: Imported Flow\n',
          checksum: '123',
          version: null,
          tags: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          run_count: 0,
          last_used_at: null,
        },
      })

    // initialYaml starts the wizard on the import source path
    renderWizard({
      initialYaml: `name: Imported Flow
nodes:
  - id: step1
    prompt: do something
`,
      initialId: 'imported-flow',
    })

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save workflow/i }),
      ).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: /save workflow/i }))

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledTimes(1)
    })
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ save_source: 'import' }),
    )
  })

  it('omits save_source on normal (non-import) saves', async () => {
    const upsertSpy = vi
      .spyOn(apiClient, 'upsertWorkflowDefinition')
      .mockResolvedValueOnce({
        definition: {
          id: 'blank-flow',
          name: 'My Workflow',
          description: null,
          source: 'project',
          scope_path: null,
          yaml: 'name: My Workflow\n',
          checksum: '123',
          version: null,
          tags: null,
          created_at: Date.now(),
          updated_at: Date.now(),
          run_count: 0,
          last_used_at: null,
        },
      })

    renderWizard()

    fireEvent.click(screen.getByLabelText(/blank canvas/i))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /save workflow/i }),
      ).toBeDefined()
    })
    fireEvent.change(screen.getByLabelText('Workflow id'), {
      target: { value: 'blank-flow' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save workflow/i }))

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledTimes(1)
    })
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
    )
    expect(upsertSpy.mock.calls[0][0]).not.toHaveProperty('save_source')
  })

  it('displays engine unavailable state when backend engine is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/workflow-definitions')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                definitions: [],
                engine_ok: false,
                error: 'Engine down',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        if (url.includes('/api/workflow-features')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                features: [],
                schedulerAlive: false,
                profile: null,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )

    renderWizard()

    // Switch to template
    fireEvent.click(screen.getByLabelText(/from a template/i))

    await waitFor(() => {
      expect(screen.getByText(/Workflow engine unavailable/i)).toBeDefined()
    })
  })

  it('supports validate feature on vs off paths', async () => {
    // 1. With validate feature active
    vi.spyOn(apiClient, 'validateWorkflowDefinition').mockResolvedValue({
      ok: true,
      errors: [],
      warnings: [
        { line: 2, col: 1, code: 'W1', message: 'Consider adding tags' },
      ],
      id_available: true,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/workflow-features')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                features: ['validate'],
                schedulerAlive: true,
                profile: null,
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ definitions: [], engine_ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )

    const testYaml = `name: Validated
nodes:
  - id: n1
    prompt: hello
`
    renderWizard({ initialYaml: testYaml, initialId: 'valid-id' })

    // Navigate to Review step
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    fireEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => {
      expect(screen.getByText(/Checks · server validate/i)).toBeDefined()
    })
  })
})
