import { useMemo, useState } from 'react'
import type { UserCommandRecord } from '@/lib/commands-api'
import {
  useCreateUserCommand,
  useDeleteUserCommand,
  useUpdateUserCommand,
  useUserCommands,
} from '@/lib/commands-api'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'

type CommandFormState = {
  id: string | null
  name: string
  slash: string
  description: string
  prompt: string
  enabled: boolean
}

const EMPTY_FORM: CommandFormState = {
  id: null,
  name: '',
  slash: '',
  description: '',
  prompt: '',
  enabled: true,
}

function commandToForm(command: UserCommandRecord): CommandFormState {
  return {
    id: command.id,
    name: command.name,
    slash: command.slash,
    description: command.description,
    prompt: command.prompt,
    enabled: command.enabled,
  }
}

function normalizeSlash(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function CommandsScreen() {
  const commandsQuery = useUserCommands()
  const createCommand = useCreateUserCommand()
  const updateCommand = useUpdateUserCommand()
  const deleteCommand = useDeleteUserCommand()
  const [form, setForm] = useState<CommandFormState>(EMPTY_FORM)
  const [search, setSearch] = useState('')

  const commands = commandsQuery.data ?? []
  const filteredCommands = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return commands
    return commands.filter((command) =>
      `${command.name} ${command.slash} ${command.description} ${command.prompt}`
        .toLowerCase()
        .includes(query),
    )
  }, [commands, search])

  const isEditing = form.id !== null
  const isBusy =
    createCommand.isPending ||
    updateCommand.isPending ||
    deleteCommand.isPending

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      name: form.name.trim(),
      slash: normalizeSlash(form.slash),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      enabled: form.enabled,
    }

    try {
      if (form.id) {
        await updateCommand.mutateAsync({ id: form.id, patch: payload })
        toast('Command updated', { type: 'success' })
      } else {
        await createCommand.mutateAsync(payload)
        toast('Command created', { type: 'success' })
      }
      setForm(EMPTY_FORM)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to save command', {
        type: 'error',
      })
    }
  }

  async function handleDelete(command: UserCommandRecord) {
    if (!window.confirm(`Delete ${command.slash}?`)) return
    try {
      await deleteCommand.mutateAsync(command.id)
      if (form.id === command.id) setForm(EMPTY_FORM)
      toast('Command deleted', { type: 'success' })
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Failed to delete command',
        { type: 'error' },
      )
    }
  }

  async function handleToggle(command: UserCommandRecord) {
    try {
      await updateCommand.mutateAsync({
        id: command.id,
        patch: { enabled: !command.enabled },
      })
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Failed to update command',
        { type: 'error' },
      )
    }
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-surface text-primary-900">
      <header className="border-b border-primary-200 px-6 py-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-500">
              SwitchUI
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-primary-950">
              Commands
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-primary-600">
              Create slash-command prompt macros for chat. These are stored in
              the SwitchUI SQLite database and expand into normal chat messages;
              they do not run shell commands.
            </p>
          </div>
          <div className="rounded-full border border-primary-200 px-3 py-1 text-xs text-primary-600">
            {commands.length} total · {commands.filter((c) => c.enabled).length}{' '}
            enabled
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-auto p-5 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="min-h-0 rounded-2xl border border-primary-200 bg-primary-50/50 p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
                Command Library
              </h2>
              <p className="mt-1 text-xs text-primary-500">
                Use <code>{'{{input}}'}</code> inside a prompt to place text
                typed after the slash command.
              </p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search commands"
              className="rounded-xl border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-400"
            />
          </div>

          {commandsQuery.isLoading ? (
            <div className="rounded-xl border border-primary-200 bg-surface p-6 text-sm text-primary-500">
              Loading commands…
            </div>
          ) : commandsQuery.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
              {commandsQuery.error instanceof Error
                ? commandsQuery.error.message
                : 'Failed to load commands'}
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="rounded-xl border border-dashed border-primary-200 bg-surface p-8 text-center">
              <h3 className="text-sm font-semibold text-primary-800">
                No commands yet
              </h3>
              <p className="mt-1 text-sm text-primary-500">
                Create your first prompt macro from the form on the right.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredCommands.map((command) => (
                <article
                  key={command.id}
                  className={cn(
                    'rounded-xl border bg-surface p-4 shadow-sm transition',
                    command.enabled
                      ? 'border-primary-200'
                      : 'border-primary-100 opacity-65',
                  )}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded-lg bg-primary-900 px-2 py-1 text-xs font-semibold text-primary-50">
                          {command.slash}
                        </code>
                        <h3 className="text-base font-semibold text-primary-950">
                          {command.name}
                        </h3>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-medium',
                            command.enabled
                              ? 'bg-green-100 text-green-700'
                              : 'bg-primary-100 text-primary-500',
                          )}
                        >
                          {command.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      {command.description ? (
                        <p className="mt-2 text-sm text-primary-600">
                          {command.description}
                        </p>
                      ) : null}
                      <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-primary-100 bg-primary-50 p-3 text-xs leading-relaxed text-primary-700">
                        {command.prompt}
                      </pre>
                      <p className="mt-2 text-[11px] text-primary-400">
                        Updated {formatDate(command.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggle(command)}
                        disabled={isBusy}
                        className="rounded-lg border border-primary-200 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                      >
                        {command.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm(commandToForm(command))}
                        disabled={isBusy}
                        className="rounded-lg border border-primary-200 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(command)}
                        disabled={isBusy}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-primary-200 bg-surface p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
              {isEditing ? 'Edit Command' : 'New Command'}
            </h2>
            {isEditing ? (
              <button
                type="button"
                onClick={() => setForm(EMPTY_FORM)}
                className="text-xs font-medium text-primary-500 hover:text-primary-800"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-1.5 text-sm font-medium text-primary-700">
              Name
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Code review"
                className="rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-400"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-primary-700">
              Slash trigger
              <input
                required
                value={form.slash}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    slash: event.target.value,
                  }))
                }
                onBlur={() =>
                  setForm((current) => ({
                    ...current,
                    slash: normalizeSlash(current.slash),
                  }))
                }
                placeholder="/review"
                className="rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 font-mono text-sm text-primary-900 outline-none focus:border-accent-400"
              />
              <span className="text-xs font-normal text-primary-500">
                Lowercase letters, numbers, and hyphens. Built-ins like /new are
                reserved.
              </span>
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-primary-700">
              Description
              <input
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Review the message for bugs"
                className="rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-400"
              />
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-primary-700">
              Prompt macro
              <textarea
                required
                value={form.prompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    prompt: event.target.value,
                  }))
                }
                placeholder={
                  'Review this for correctness, risks, and missing tests:\n\n{{input}}'
                }
                rows={10}
                className="resize-y rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm leading-relaxed text-primary-900 outline-none focus:border-accent-400"
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-primary-700">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              Enabled in slash menu and command palette
            </label>

            <button
              type="submit"
              disabled={isBusy}
              className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-600 disabled:opacity-50"
            >
              {isBusy
                ? 'Saving…'
                : isEditing
                  ? 'Save command'
                  : 'Create command'}
            </button>
          </form>
        </aside>
      </div>
    </main>
  )
}
