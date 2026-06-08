import '@/styles/matrix-mcp.css'

import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { UserCommandRecord } from '@/lib/commands-api'
import {
  useCreateUserCommand,
  useDeleteUserCommand,
  useUpdateUserCommand,
  useUserCommands,
} from '@/lib/commands-api'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { Ico } from '@/screens/mcp/icons'

type CommandFormState = {
  id: string | null
  name: string
  slash: string
  description: string
  prompt: string
  enabled: boolean
}

type StatusFilter = 'all' | 'enabled' | 'disabled'

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

function commandMatches(command: UserCommandRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return `${command.name} ${command.slash} ${command.description} ${command.prompt}`
    .toLowerCase()
    .includes(normalized)
}

function commandInitials(command: UserCommandRecord): string {
  return (
    command.name
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '/'
  )
}

export function CommandsScreen() {
  const commandsQuery = useUserCommands()
  const createCommand = useCreateUserCommand()
  const updateCommand = useUpdateUserCommand()
  const deleteCommand = useDeleteUserCommand()
  const [form, setForm] = useState<CommandFormState>(EMPTY_FORM)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [filtersCollapsed, setFiltersCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<'editor' | 'preview'>('editor')

  const commands = commandsQuery.data ?? []
  const enabledCount = commands.filter((command) => command.enabled).length
  const disabledCount = commands.length - enabledCount
  const isEditing = form.id !== null
  const isBusy =
    createCommand.isPending ||
    updateCommand.isPending ||
    deleteCommand.isPending

  const filteredCommands = useMemo(() => {
    return commands.filter((command) => {
      const statusMatches =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && command.enabled) ||
        (statusFilter === 'disabled' && !command.enabled)
      return statusMatches && commandMatches(command, search)
    })
  }, [commands, search, statusFilter])

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
  }

  function startNewCommand() {
    setForm(EMPTY_FORM)
    setDrawerTab('editor')
    setDrawerOpen(true)
  }

  function startEditCommand(command: UserCommandRecord) {
    setForm(commandToForm(command))
    setDrawerTab('editor')
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setForm(EMPTY_FORM)
    setDrawerTab('editor')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      closeDrawer()
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
      if (form.id === command.id) closeDrawer()
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
    <div
      className={cn('mcp-shell', filtersCollapsed && 'mcp-filters-collapsed')}
      data-screen="mcp"
    >
      {filtersCollapsed ? (
        <aside className="mcp-filter is-collapsed">
          <div className="mcp-filter-hdr justify-center">
            <button
              type="button"
              className="mcp-ico-btn"
              onClick={() => setFiltersCollapsed(false)}
              title="Expand command filters"
              aria-label="Expand command filters"
            >
              {Ico.unfold}
            </button>
          </div>
          <div className="mcp-filter-rail">
            <span className="mcp-badge-n">{filteredCommands.length}</span>
            <span className="mcp-vlabel">Commands</span>
          </div>
          <div className="mcp-filter-foot">
            <button
              type="button"
              className="mcp-btn mcp-btn-sm mcp-btn-primary justify-center"
              onClick={startNewCommand}
              title="New command"
              aria-label="New command"
            >
              {Ico.plus}
            </button>
          </div>
        </aside>
      ) : (
        <aside className="mcp-filter">
          <div className="mcp-filter-hdr">
            <h3>Commands</h3>
            <span className="mcp-ct">{filteredCommands.length}</span>
            <span className="mcp-actions">
              <button
                type="button"
                className="mcp-ico-btn"
                onClick={resetFilters}
                title="Reset filters"
              >
                {Ico.refresh}
              </button>
              <button
                type="button"
                className="mcp-ico-btn"
                onClick={() => setFiltersCollapsed(true)}
                title="Collapse command filters"
                aria-label="Collapse command filters"
              >
                {Ico.fold}
              </button>
            </span>
          </div>

          <div className="mcp-filter-search">
            <div className="flex items-center gap-2 px-2 py-1.5">
              {Ico.search}
              <input
                placeholder="search commands…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="mcp-filter-body">
            <div className="mcp-filter-grp">
              <h4>Status</h4>
              <div className="mcp-seg-stack">
                {(
                  [
                    { id: 'all', label: 'All', count: commands.length },
                    { id: 'enabled', label: 'Enabled', count: enabledCount },
                    { id: 'disabled', label: 'Disabled', count: disabledCount },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={cn(statusFilter === option.id && 'on')}
                    onClick={() => setStatusFilter(option.id)}
                  >
                    {option.label}
                    <span className="mcp-ct">{option.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mcp-filter-grp">
              <h4>Usage</h4>
              <div className="grid gap-2 px-2 text-xs leading-relaxed text-[var(--m-text-muted,var(--theme-muted))]">
                <p>
                  Slash commands expand into normal chat text. They are prompt
                  macros, not shell commands.
                </p>
                <p>
                  Use{' '}
                  <code className="text-[var(--m-green-500)]">
                    {'{{input}}'}
                  </code>{' '}
                  in a prompt to insert text typed after the trigger.
                </p>
              </div>
            </div>
          </div>

          <div className="mcp-filter-foot">
            <button
              type="button"
              className="mcp-btn mcp-btn-sm mcp-btn-primary justify-center"
              onClick={startNewCommand}
            >
              {Ico.plus} New Command
            </button>
            <span className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--m-text-faint,var(--theme-muted))]">
              switchui sqlite
            </span>
          </div>
        </aside>
      )}

      <main className="mcp-main">
        <div className="mcp-top">
          <div>
            <div className="mcp-crumbs">
              Hermes Switch UI<span className="mcp-sep">·</span>Commands
            </div>
            <h1>Slash Commands</h1>
            <div className="mcp-sub">
              Create reusable prompt macros for Chat Composer. Commands are
              stored in SwitchUI SQLite and appear in the slash picker.
            </div>
          </div>
          <div className="mcp-right">
            <div className="mcp-stat">
              <span>Total</span>
              <b>{commands.length}</b>
            </div>
            <div className="mcp-stat">
              <span>Enabled</span>
              <b>{enabledCount}</b>
            </div>
            <button
              type="button"
              className="mcp-btn mcp-btn-primary"
              onClick={startNewCommand}
            >
              {Ico.plus} New Command
            </button>
          </div>
        </div>

        <div className="mcp-toolbar">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--m-text-faint,var(--theme-muted))]">
            {filteredCommands.length} of {commands.length}
          </span>
          <span className="mcp-grow" />
          <span className="mcp-sort">prompt macros · slash menu</span>
        </div>

        <div className="mcp-canvas">
          <section className="min-w-0">
            {commandsQuery.isLoading ? (
              <div className="mcp-empty">
                <div className="mcp-glyph">…</div>
                Loading commands…
              </div>
            ) : commandsQuery.error ? (
              <div className="mcp-empty text-red-400">
                <div className="mcp-glyph">!</div>
                {commandsQuery.error instanceof Error
                  ? commandsQuery.error.message
                  : 'Failed to load commands'}
              </div>
            ) : filteredCommands.length === 0 ? (
              <div className="mcp-empty">
                <div className="mcp-glyph">∅</div>
                no commands match.
                <br />
                <span className="text-[var(--m-text-muted,var(--theme-muted))]">
                  clear filters or create a new command.
                </span>
              </div>
            ) : (
              <div className="mcp-grid">
                {filteredCommands.map((command) => (
                  <article
                    key={command.id}
                    className={cn(
                      'mcp-card',
                      command.enabled ? 'mcp-connected' : 'opacity-70',
                    )}
                  >
                    <div className="mcp-hd">
                      <div className="mcp-glyph">
                        {commandInitials(command)}
                      </div>
                      <div className="min-w-0">
                        <div className="mcp-name">{command.name}</div>
                        <div className="mcp-by">{command.slash}</div>
                      </div>
                      <div className="mcp-right">
                        <span
                          className={cn(
                            'mcp-status-pill',
                            command.enabled ? 'mcp-ok' : 'mcp-unknown',
                          )}
                        >
                          <span className="mcp-d" />
                          {command.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                    </div>

                    <div className="mcp-endpoint whitespace-normal">
                      <span className="mcp-scheme">/</span>
                      <span>{command.slash.replace(/^\//, '')}</span>
                    </div>

                    <div className="mcp-kvgrid">
                      <div className="mcp-kv">
                        <span className="mcp-lbl">Updated</span>
                        <b className="mcp-zero text-[11px]">
                          {formatDate(command.updatedAt)}
                        </b>
                      </div>
                      <div className="mcp-kv">
                        <span className="mcp-lbl">Source</span>
                        <b className="mcp-live">SwitchUI</b>
                      </div>
                    </div>

                    <div className="mcp-bd whitespace-normal">
                      {command.description || 'No description yet.'}
                    </div>

                    <pre className="mt-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--m-border-subtle,var(--theme-border))] bg-[var(--m-bg-deep,var(--theme-bg))] p-3 text-xs leading-relaxed text-[var(--m-text-muted,var(--theme-muted))]">
                      {command.prompt}
                    </pre>

                    <div className="mcp-ft">
                      <button
                        type="button"
                        className="mcp-btn-mini"
                        disabled={isBusy}
                        onClick={() => startEditCommand(command)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="mcp-btn-mini"
                        disabled={isBusy}
                        onClick={() => void handleToggle(command)}
                      >
                        {command.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <span className="mcp-grow" />
                      <button
                        type="button"
                        className="mcp-btn-mini mcp-danger"
                        disabled={isBusy}
                        onClick={() => void handleDelete(command)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="mcp-foot">
          <span>
            <b>{commands.length}</b> commands
          </span>
          <span className="mcp-sep" />
          <span>
            <b className="mcp-ok">{enabledCount}</b> enabled
          </span>
          <span className="mcp-sep" />
          <span>
            storage <b>switchui.db</b>
          </span>
          <span className="mcp-foot-updated">
            updated <b>now</b>
          </span>
        </footer>
      </main>

      {drawerOpen ? (
        <>
          <div className="mcp-drawer-scrim open" onClick={closeDrawer} />
          <aside className="mcp-drawer open">
            <div className="mcp-drawer-hdr">
              <div className="mcp-glyph">/</div>
              <div className="min-w-0">
                <h2>
                  {isEditing ? form.name || 'Edit Command' : 'New Command'}
                </h2>
                <div className="mcp-meta-line">
                  <span>
                    {isEditing ? form.slash || 'custom slash' : 'custom slash'}
                  </span>
                  <span>{form.enabled ? 'enabled' : 'disabled'}</span>
                  <span>switchui.db</span>
                </div>
              </div>
              <div className="mcp-hdr-actions">
                <button
                  type="button"
                  className="mcp-ico-btn"
                  onClick={closeDrawer}
                  title="Close"
                  aria-label="Close command drawer"
                >
                  {Ico.x}
                </button>
              </div>
            </div>

            <div className="mcp-drawer-tabs">
              <button
                type="button"
                className={cn(drawerTab === 'editor' && 'on')}
                onClick={() => setDrawerTab('editor')}
              >
                {Ico.edit}
                <span>Editor</span>
              </button>
              <button
                type="button"
                className={cn(drawerTab === 'preview' && 'on')}
                onClick={() => setDrawerTab('preview')}
              >
                {Ico.doc}
                <span>Preview</span>
              </button>
            </div>

            <div className="mcp-drawer-body">
              {drawerTab === 'editor' ? (
                <form
                  className="grid gap-3"
                  id="command-form"
                  onSubmit={handleSubmit}
                >
                  <div className="mcp-panel-card">
                    <div className="mcp-pc-hd">
                      <span>Command identity</span>
                      <span className="mcp-right">
                        {isEditing ? 'edit' : 'create'}
                      </span>
                    </div>
                    <div className="mcp-pc-bd grid gap-3">
                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted,var(--theme-muted))]">
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
                          className="rounded-md border border-[var(--m-border,var(--theme-border))] bg-[var(--m-bg-deep,var(--theme-bg))] px-3 py-2 font-sans text-sm normal-case tracking-normal text-[var(--m-text,var(--theme-text))] outline-none focus:border-[var(--m-green-500,var(--theme-accent))]"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted,var(--theme-muted))]">
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
                          className="rounded-md border border-[var(--m-border,var(--theme-border))] bg-[var(--m-bg-deep,var(--theme-bg))] px-3 py-2 font-mono text-sm normal-case tracking-normal text-[var(--m-text,var(--theme-text))] outline-none focus:border-[var(--m-green-500,var(--theme-accent))]"
                        />
                        <span className="font-sans text-[11px] font-normal normal-case leading-relaxed tracking-normal text-[var(--m-text-faint,var(--theme-muted))]">
                          Built-ins like /new and /help are reserved.
                        </span>
                      </label>

                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted,var(--theme-muted))]">
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
                        Enabled in slash menu
                      </label>
                    </div>
                  </div>

                  <div className="mcp-panel-card">
                    <div className="mcp-pc-hd">
                      <span>Prompt macro</span>
                      <span className="mcp-right">{'{{input}}'} aware</span>
                    </div>
                    <div className="mcp-pc-bd grid gap-3">
                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted,var(--theme-muted))]">
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
                          className="rounded-md border border-[var(--m-border,var(--theme-border))] bg-[var(--m-bg-deep,var(--theme-bg))] px-3 py-2 font-sans text-sm normal-case tracking-normal text-[var(--m-text,var(--theme-text))] outline-none focus:border-[var(--m-green-500,var(--theme-accent))]"
                        />
                      </label>

                      <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--m-text-muted,var(--theme-muted))]">
                        Prompt
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
                          rows={14}
                          className="resize-y rounded-md border border-[var(--m-border,var(--theme-border))] bg-[var(--m-bg-deep,var(--theme-bg))] px-3 py-2 font-sans text-sm normal-case leading-relaxed tracking-normal text-[var(--m-text,var(--theme-text))] outline-none focus:border-[var(--m-green-500,var(--theme-accent))]"
                        />
                      </label>
                    </div>
                  </div>
                </form>
              ) : (
                <>
                  <div className="mcp-preview-grid">
                    <div className="mcp-stat-card">
                      <div className="mcp-lbl">Trigger</div>
                      <b>{normalizeSlash(form.slash) || '/command'}</b>
                      <div className="mcp-sub">slash picker label</div>
                    </div>
                    <div className="mcp-stat-card">
                      <div className="mcp-lbl">State</div>
                      <b>{form.enabled ? 'enabled' : 'disabled'}</b>
                      <div className="mcp-sub">visibility in composer</div>
                    </div>
                  </div>
                  <div className="mcp-panel-card">
                    <div className="mcp-pc-hd">
                      <span>Description</span>
                    </div>
                    <div className="mcp-pc-bd text-sm text-[var(--m-text-muted,var(--theme-muted))]">
                      {form.description || 'No description yet.'}
                    </div>
                  </div>
                  <div className="mcp-panel-card">
                    <div className="mcp-pc-hd">
                      <span>Expanded prompt preview</span>
                    </div>
                    <div className="mcp-pc-bd">
                      <pre className="mcp-config-preview whitespace-pre-wrap">
                        {(
                          form.prompt || 'Prompt body will appear here.'
                        ).replace(
                          /{{input}}/g,
                          'Example input from chat composer',
                        )}
                      </pre>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mcp-drawer-foot">
              <span className="mcp-src-line">
                <span className="mcp-lbl">storage</span> switchui.db commands
              </span>
              <button type="button" className="mcp-btn" onClick={closeDrawer}>
                Cancel
              </button>
              <button
                type="submit"
                form="command-form"
                disabled={isBusy}
                className="mcp-btn mcp-btn-primary"
              >
                {isBusy
                  ? 'Saving…'
                  : isEditing
                    ? 'Save Command'
                    : 'Create Command'}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  )
}
