import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  InstantiateResult,
  KanbanTemplate,
  KanbanTemplateSummary,
  TemplateVariable,
} from '@/lib/hermes-kanban-types'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  TemplateRequestError,
  useDeleteTemplate,
  useInstantiateTemplate,
  useSaveTemplate,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
} from '@/lib/board-templates-api'
import { toast } from '@/components/ui/toast'
import '@/styles/matrix-boards.css'

const SIZE_WARN_BYTES = 64 * 1024

const TEMPLATE_STARTER = `schema: 1
slug: my-template
name: My Template
description: ""
variables:
  - key: project
    required: true
    prompt: Project name
    description: Used to title generated tasks
tasks:
  - key: setup
    title: "Set up {{project}}"
    status: triage
`

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  return text.length
}

function backendDetail(error: unknown, fallback: string): string {
  if (error instanceof TemplateRequestError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

/** Re-serialize a parsed template to YAML with recurrence.enabled toggled. */
function withRecurrenceEnabled(yamlText: string, enabled: boolean): string {
  const doc = parseYaml(yamlText) as Record<string, unknown> | null
  const next = (doc && typeof doc === 'object' ? { ...doc } : {}) as Record<string, unknown>
  const existing = (next.recurrence && typeof next.recurrence === 'object'
    ? { ...(next.recurrence as Record<string, unknown>) }
    : {}) as Record<string, unknown>
  existing.enabled = enabled
  next.recurrence = existing
  return stringifyYaml(next)
}

/** Serialize a fetched template object back to editable YAML. */
function templateToYaml(template: KanbanTemplate): string {
  return stringifyYaml(template)
}

// ── List ──────────────────────────────────────────────────────────────────────

function TemplateRow({
  template,
  onOpen,
  onInstantiate,
  onDelete,
}: {
  template: KanbanTemplateSummary
  onOpen: (slug: string) => void
  onInstantiate: (template: KanbanTemplateSummary) => void
  onDelete: (template: KanbanTemplateSummary) => void
}) {
  return (
    <tr onClick={() => onOpen(template.slug)} style={{ ['--bc' as string]: template.color || '#5ad3ff' }}>
      <td>
        <div className="tbl-name-cell">
          <div className="tbl-glyph">{(template.name || template.slug).slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="tbl-nm">{template.name || template.slug}</div>
            <div className="tbl-tp">{template.slug}</div>
          </div>
        </div>
      </td>
      <td>{template.variables.length}</td>
      <td>
        {template.has_recurrence ? (
          <span className="status-pill active">
            <span className="d" />
            recurring
          </span>
        ) : (
          <span className="tbl-time">—</span>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="tbl-acts">
          <button className="btn-mini" onClick={() => onInstantiate(template)}>
            Use
          </button>
          <button className="btn-mini" onClick={() => onOpen(template.slug)}>
            Edit
          </button>
          <button className="btn-mini danger" onClick={() => onDelete(template)}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Editor drawer (raw YAML) ────────────────────────────────────────────────────

function TemplateEditor({
  slug,
  onClose,
  onSaved,
  onInstantiate,
}: {
  slug: string | null // null = create
  onClose: () => void
  onSaved: () => void
  onInstantiate: (slug: string) => void
}) {
  const isCreate = slug === null
  const detailQuery = useTemplate(slug, !isCreate)
  const saveMutation = useSaveTemplate()
  const updateMutation = useUpdateTemplate()
  const [yamlText, setYamlText] = useState(isCreate ? TEMPLATE_STARTER : '')
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Hydrate the editor once the detail query resolves.
  useEffect(() => {
    if (isCreate) return
    if (detailQuery.data && loadedSlug !== slug) {
      setYamlText(templateToYaml(detailQuery.data))
      setLoadedSlug(slug)
    }
  }, [detailQuery.data, isCreate, loadedSlug, slug])

  const size = byteLength(yamlText)
  const oversized = size > SIZE_WARN_BYTES
  const recurrence = detailQuery.data?.recurrence
  const saving = saveMutation.isPending || updateMutation.isPending

  async function handleSave() {
    setError(null)
    try {
      if (isCreate) {
        const res = await saveMutation.mutateAsync({ yaml: yamlText })
        toast(`Template "${res.template.name || res.template.slug}" created`, { type: 'success' })
      } else {
        const res = await updateMutation.mutateAsync({ slug: slug, yaml: yamlText })
        toast(`Template "${res.template.name || res.template.slug}" updated`, { type: 'success' })
      }
      onSaved()
    } catch (err) {
      setError(backendDetail(err, 'Failed to save template'))
    }
  }

  async function handleToggleRecurrence(enabled: boolean) {
    setError(null)
    try {
      const nextYaml = withRecurrenceEnabled(yamlText, enabled)
      setYamlText(nextYaml)
      const res = await updateMutation.mutateAsync({ slug: slug as string, yaml: nextYaml })
      toast(`Recurrence ${enabled ? 'enabled' : 'disabled'}`, { type: 'success' })
      setYamlText(templateToYaml(res.template))
    } catch (err) {
      setError(backendDetail(err, 'Failed to update recurrence'))
    }
  }

  const loading = !isCreate && detailQuery.isLoading

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={isCreate ? 'New template' : slug || 'Template'}>
        <div className="dr-head">
          <div className="dr-title-row">
            <div className="dr-glyph" style={{ ['--bc' as string]: '#5ad3ff' }}>
              {isCreate ? '+' : (slug || '?').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2>{isCreate ? 'New Template' : detailQuery.data?.name || slug}</h2>
              <div className="dr-meta">
                <span>{isCreate ? 'raw YAML' : slug}</span>
                <span>{size.toLocaleString()} bytes</span>
              </div>
            </div>
          </div>
          <div className="dr-acts">
            {!isCreate ? (
              <button className="btn-mini" onClick={() => onInstantiate(slug)}>
                Use
              </button>
            ) : null}
            <button className="ico-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="dr-body">
          {loading ? (
            <div className="brd-loading">Loading template…</div>
          ) : (
            <>
              {recurrence ? (
                <div className="panel-card">
                  <div className="pc-head">Recurrence</div>
                  <div className="pc-body ws-grid">
                    <div className="ws-lbl">Schedule (cron)</div>
                    <div className="ws-val path">{recurrence.cron || '—'}</div>
                    <div className="ws-lbl">Timezone</div>
                    <div className="ws-val">{recurrence.timezone || '—'}</div>
                    <div className="ws-lbl">Enabled</div>
                    <div className="ws-val">
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={!!recurrence.enabled}
                          disabled={saving}
                          onChange={(e) => void handleToggleRecurrence(e.target.checked)}
                        />
                        {recurrence.enabled ? 'Active' : 'Paused'}
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="panel-card">
                <div className="pc-head">
                  Template YAML
                  {oversized ? (
                    <div className="pc-head-right" style={{ color: '#ff5fa2' }}>
                      {(size / 1024).toFixed(1)} KB — exceeds 64 KB
                    </div>
                  ) : null}
                </div>
                <div className="pc-body">
                  <textarea
                    className="form-ta"
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minHeight: 360,
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'pre',
                      overflowWrap: 'normal',
                    }}
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                  />
                </div>
              </div>

              {error ? (
                <div className="panel-card" style={{ borderColor: '#ff5fa2' }}>
                  <div className="pc-head" style={{ color: '#ff5fa2' }}>
                    Backend rejected the template
                  </div>
                  <div className="pc-body description-copy">{error}</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="dr-foot">
          <span className="dr-foot-time">{oversized ? 'Reduce size before saving' : 'YAML editor'}</span>
          <div className="dr-foot-acts">
            <button className="btn-mini" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-mini prim" disabled={saving} onClick={() => void handleSave()}>
              {saving ? 'Saving…' : isCreate ? 'Create' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Instantiate modal ───────────────────────────────────────────────────────────

function InstantiateModal({
  slug,
  onClose,
}: {
  slug: string
  onClose: () => void
}) {
  const detailQuery = useTemplate(slug)
  const instantiateMutation = useInstantiateTemplate()
  const [values, setValues] = useState<Record<string, string>>({})
  const [boardSlug, setBoardSlug] = useState('')
  const [autoDispatch, setAutoDispatch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InstantiateResult | null>(null)

  const variables: Array<TemplateVariable> = detailQuery.data?.variables ?? []

  // Seed defaults once when the template detail arrives.
  useEffect(() => {
    if (!detailQuery.data) return
    setValues((prev) => {
      const seeded = { ...prev }
      for (const v of detailQuery.data.variables ?? []) {
        if (!(v.key in seeded)) seeded[v.key] = v.default ?? ''
      }
      return seeded
    })
  }, [detailQuery.data])

  const missingRequired = variables.some((v) => {
    const val = values[v.key]
    return v.required && !(val && val.trim())
  })

  async function handleInstantiate() {
    setError(null)
    try {
      const res = await instantiateMutation.mutateAsync({
        slug,
        input: {
          variables: values,
          board_slug: boardSlug.trim() || undefined,
          auto_dispatch: autoDispatch,
        },
      })
      setResult(res)
      toast(`Instantiated → ${res.board_slug} (${res.created} created, ${res.skipped} skipped)`, {
        type: 'success',
      })
    } catch (err) {
      setError(backendDetail(err, 'Failed to instantiate template'))
    }
  }

  return (
    <div className="wizard-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">▶</div>
          <div>
            <h2>Use Template</h2>
            <div className="wz-sub">{detailQuery.data?.name || slug}</div>
          </div>
          <button className="wz-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="wz-body">
          {detailQuery.isLoading ? (
            <div className="brd-loading">Loading template…</div>
          ) : result ? (
            <div className="review-block">
              <div className="rb-row">
                <span className="rb-k">Board</span>
                <span className="rb-v">
                  <Link to="/tasks" onClick={onClose}>
                    {result.board_slug}
                  </Link>
                </span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Instance</span>
                <span className="rb-v path">{result.instance_id}</span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Created</span>
                <span className="rb-v">{result.created}</span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Skipped</span>
                <span className="rb-v">{result.skipped}</span>
              </div>
            </div>
          ) : (
            <>
              {variables.length === 0 ? (
                <p className="wz-p">This template has no variables. Instantiate directly.</p>
              ) : (
                variables.map((v) => (
                  <div key={v.key} className="form-row">
                    <label>
                      {v.prompt || v.key} {v.required ? <span className="req">*</span> : null}
                    </label>
                    <input
                      className="form-inp"
                      placeholder={v.default ?? ''}
                      value={values[v.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                    />
                    {v.description ? <span className="form-hint">{v.description}</span> : null}
                  </div>
                ))
              )}

              <div className="form-row">
                <label>Board slug (optional)</label>
                <input
                  className="form-inp"
                  placeholder="auto-generated if blank"
                  value={boardSlug}
                  onChange={(e) => setBoardSlug(e.target.value)}
                />
                <span className="form-hint">Target board for the instantiated tasks.</span>
              </div>

              <div className="form-row">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoDispatch}
                    onChange={(e) => setAutoDispatch(e.target.checked)}
                  />
                  Auto-dispatch tasks to agents
                </label>
              </div>

              {error ? (
                <div className="panel-card" style={{ borderColor: '#ff5fa2', marginTop: 8 }}>
                  <div className="pc-head" style={{ color: '#ff5fa2' }}>
                    {error.includes('409') || error.toLowerCase().includes('refused')
                      ? 'Instantiation refused'
                      : 'Instantiation failed'}
                  </div>
                  <div className="pc-body description-copy">{error}</div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="wz-foot">
          <span className="wz-foot-step">{result ? 'Done' : `${variables.length} variable${variables.length === 1 ? '' : 's'}`}</span>
          <div className="wz-nav">
            {result ? (
              <button className="btn-mini prim" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button className="btn-mini" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn-mini prim"
                  disabled={instantiateMutation.isPending || missingRequired || detailQuery.isLoading}
                  onClick={() => void handleInstantiate()}
                >
                  {instantiateMutation.isPending ? 'Instantiating…' : 'Instantiate'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirm ──────────────────────────────────────────────────────────────

function DeleteConfirm({
  template,
  onCancel,
  onConfirm,
  deleting,
}: {
  template: KanbanTemplateSummary
  onCancel: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}) {
  return (
    <div className="confirm-scrim">
      <div className="confirm-box">
        <h3>Delete Template</h3>
        <p>
          Permanently delete <span className="conf-name">{template.name || template.slug}</span>?
          This cannot be undone.
        </p>
        <div className="conf-acts">
          <button className="btn-mini" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-mini danger" disabled={deleting} onClick={() => void onConfirm()}>
            Delete Template
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Degraded state (backend too old / endpoint 404) ─────────────────────────────

function TemplatesUnsupported() {
  return (
    <div className="brd-canvas">
      <div className="empty-state">
        <div className="es-title">Templates require a newer Hermes Agent</div>
        <div className="es-sub">
          The connected Hermes Agent does not expose the board templates API. Update the Agent and
          its Kanban plugin to use this feature.
        </div>
      </div>
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────────

export function BoardTemplatesScreen() {
  usePageTitle('Board Templates')
  const templatesQuery = useTemplates()
  const deleteMutation = useDeleteTemplate()
  const [search, setSearch] = useState('')
  const [editorSlug, setEditorSlug] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [instantiateSlug, setInstantiateSlug] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<KanbanTemplateSummary | null>(null)

  const templates = templatesQuery.data?.templates ?? []
  const filtered = useMemo(
    () =>
      templates.filter((t) => {
        if (!search) return true
        return `${t.name} ${t.slug} ${t.description ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      }),
    [templates, search],
  )

  // Degraded: backend endpoint missing (404).
  const is404 =
    templatesQuery.isError &&
    templatesQuery.error instanceof TemplateRequestError &&
    templatesQuery.error.status === 404

  return (
    <div data-screen="boards" className="boards-screen-root">
      <div className="brd-main">
        <div className="brd-top">
          <div>
            <div className="crumbs">
              Workspace<span className="sep">/</span>Tasks<span className="sep">/</span>
              <span className="cur">Templates</span>
            </div>
            <h1>Board Templates</h1>
            <div className="top-sub">Reusable board definitions with variables and recurrence.</div>
          </div>
          <div className="top-right">
            <div className="top-stat">
              <b>{templates.length}</b>Templates
            </div>
            <button
              className="btn-prim"
              onClick={() => {
                setCreating(true)
                setEditorSlug(null)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Template
            </button>
          </div>
        </div>

        <div className="brd-toolbar">
          <div className="tb-grow">
            <div className="brd-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className="brd-search-inp"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
              />
            </div>
          </div>
        </div>

        {templatesQuery.isLoading ? (
          <div className="brd-loading">Loading templates…</div>
        ) : is404 ? (
          <TemplatesUnsupported />
        ) : templatesQuery.isError ? (
          <div className="brd-error">
            {templatesQuery.error instanceof Error
              ? templatesQuery.error.message
              : 'Templates unavailable'}
          </div>
        ) : filtered.length === 0 ? (
          <div className="brd-canvas">
            <div className="empty-state">
              <div className="es-title">No templates found</div>
              <div className="es-sub">Create a template from raw YAML to get started.</div>
            </div>
          </div>
        ) : (
          <div className="brd-canvas">
            <table className="brd-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Variables</th>
                  <th>Recurrence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <TemplateRow
                    key={t.slug}
                    template={t}
                    onOpen={(slug) => {
                      setCreating(false)
                      setEditorSlug(slug)
                    }}
                    onInstantiate={(tpl) => setInstantiateSlug(tpl.slug)}
                    onDelete={setConfirmDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editorSlug !== null ? (
        <TemplateEditor
          slug={creating ? null : editorSlug}
          onClose={() => {
            setEditorSlug(null)
            setCreating(false)
          }}
          onSaved={() => {
            setEditorSlug(null)
            setCreating(false)
          }}
          onInstantiate={(slug) => {
            setEditorSlug(null)
            setCreating(false)
            setInstantiateSlug(slug)
          }}
        />
      ) : null}

      {instantiateSlug ? (
        <InstantiateModal slug={instantiateSlug} onClose={() => setInstantiateSlug(null)} />
      ) : null}

      {confirmDelete ? (
        <DeleteConfirm
          template={confirmDelete}
          deleting={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync(confirmDelete.slug)
              toast(`Deleted ${confirmDelete.name || confirmDelete.slug}`, { type: 'success' })
              if (editorSlug === confirmDelete.slug) setEditorSlug(null)
              setConfirmDelete(null)
            } catch (err) {
              toast(backendDetail(err, 'Failed to delete template'), { type: 'error' })
            }
          }}
        />
      ) : null}
    </div>
  )
}
