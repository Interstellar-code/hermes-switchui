'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowUp02Icon,
  Cancel01Icon,
  Loading03Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons'
import type {
  ApplyUpdateResult,
  ProductId,
  ProductUpdateStatus,
  ReleaseNoteSection,
  UpdateStatus,
} from '@/lib/update-center'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import {
  UPDATE_STATUS_QUERY_KEY,
  applyDesktopWorkspaceUpdate,
  fetchUpdateStatus,
  mergeDesktopUpdateState,
  subscribeDesktopUpdates,
} from '@/lib/update-center'

type Phase = 'idle' | 'updating' | 'done' | 'error'
type Notes = {
  id: string
  sections: Array<ReleaseNoteSection>
  updatedAt: number
}

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const DISMISS_PREFIX = 'hermes-update-v2-dismissed:'
const NOTES_KEY = 'hermes-update-v2-release-notes'
const NOTES_SEEN_KEY = 'hermes-update-v2-release-notes-seen'

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : 'unknown'
}

function productVersionLabel(product: ProductUpdateStatus): string {
  return product.installKind === 'desktop'
    ? (product.targetVersion ?? product.version)
    : shortSha(product.latestHead)
}

function productDismissKey(product: ProductUpdateStatus): string {
  return `${product.id}:${product.latestHead ?? product.version}`
}

function notesId(sections: Array<ReleaseNoteSection>): string {
  return sections
    .map((section) => `${section.product}:${section.from}:${section.to}`)
    .sort()
    .join('|')
}

function storeNotes(sections: Array<ReleaseNoteSection>): Notes | null {
  if (!sections.length) return null
  const id = notesId(sections)
  const notes = { id, sections, updatedAt: Date.now() }
  // Only clear the "seen" marker when the release-notes payload actually
  // changed. Without this guard the modal pops up on every page refresh
  // because /api/update/status returns the same pendingReleaseNotes on every
  // poll, useEffect fires, and we used to drop the seen marker every time.
  // See #356.
  let existingId: string | null = null
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Notes
      existingId = parsed.id
    }
  } catch {
    existingId = null
  }
  if (existingId !== id) {
    localStorage.removeItem(NOTES_SEEN_KEY)
  }
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  return notes
}

function readNotes(): Notes | null {
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Notes
    if (!parsed.id || !Array.isArray(parsed.sections)) return null
    if (localStorage.getItem(NOTES_SEEN_KEY) === parsed.id) return null
    return parsed
  } catch {
    return null
  }
}

export function UpdateCenterNotifier() {
  const queryClient = useQueryClient()
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [phases, setPhases] = useState<Record<ProductId, Phase>>({
    workspace: 'idle',
    agent: 'idle',
  })
  const [errors, setErrors] = useState<Record<ProductId, string>>({
    workspace: '',
    agent: '',
  })
  const [notes, setNotes] = useState<Notes | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const values = new Set<string>()
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DISMISS_PREFIX))
        values.add(localStorage.getItem(key) || '')
    }
    setDismissed(values)
    setNotes(readNotes())
  }, [])

  const { data, refetch, isFetching } = useQuery({
    queryKey: UPDATE_STATUS_QUERY_KEY,
    queryFn: fetchUpdateStatus,
    refetchInterval: CHECK_INTERVAL_MS,
    staleTime: CHECK_INTERVAL_MS,
    retry: false,
  })

  useEffect(
    () =>
      subscribeDesktopUpdates((state) => {
        queryClient.setQueryData<UpdateStatus>(
          UPDATE_STATUS_QUERY_KEY,
          (current) =>
            current ? mergeDesktopUpdateState(current, state) : current,
        )
      }),
    [queryClient],
  )

  useEffect(() => {
    if (!data?.pendingReleaseNotes?.length) return
    const stored = storeNotes(data.pendingReleaseNotes)
    if (stored) setNotes((current) => current ?? stored)
  }, [data?.pendingReleaseNotes])

  const visibleProducts = useMemo(() => {
    const products = data ? [data.products.workspace, data.products.agent] : []
    return products.filter((product) => {
      if (!product.updateAvailable) return false
      // Local development commonly has intentional source edits. Keep the
      // diagnosis in Settings → Updates without repeatedly raising a global
      // popup that cannot perform an action.
      if (import.meta.env.DEV && !product.canUpdate) return false
      if (phases[product.id] === 'done') return false
      return !dismissed.has(productDismissKey(product))
    })
  }, [data, dismissed, phases])

  function dismiss(product: ProductUpdateStatus) {
    const key = productDismissKey(product)
    localStorage.setItem(`${DISMISS_PREFIX}${product.id}`, key)
    setDismissed((prev) => new Set([...prev, key]))
  }

  async function update(product: ProductUpdateStatus) {
    if (!product.canUpdate) return
    if (
      !window.confirm(
        `Update ${product.label} from ${product.installKind === 'desktop' ? product.version : shortSha(product.currentHead)} to ${productVersionLabel(product)}?`,
      )
    )
      return
    setPhases((prev) => ({ ...prev, [product.id]: 'updating' }))
    setErrors((prev) => ({ ...prev, [product.id]: '' }))
    try {
      const result =
        product.installKind === 'desktop'
          ? await applyDesktopWorkspaceUpdate()
          : await (async () => {
              const res = await fetch(
                `/api/update/${product.id === 'workspace' ? 'workspace' : 'agent'}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    expectedCurrentHead: product.currentHead,
                    expectedTargetHead: product.latestHead,
                  }),
                },
              )
              return {
                response: res,
                result: (await res.json()) as ApplyUpdateResult,
              }
            })()
      const response = 'response' in result ? result.response : null
      const applyResult = 'result' in result ? result.result : result
      if ((response && !response.ok) || !applyResult.ok) {
        setPhases((prev) => ({ ...prev, [product.id]: 'error' }))
        setErrors((prev) => ({
          ...prev,
          [product.id]: applyResult.error || `${product.label} update failed`,
        }))
        return
      }
      const desktopDownloaded =
        product.installKind === 'desktop' && !applyResult.restartRequired
      setPhases((prev) => ({
        ...prev,
        [product.id]: desktopDownloaded ? 'idle' : 'done',
      }))
      if (!desktopDownloaded) dismiss(product)
      const stored = applyResult.releaseNotes?.length
        ? storeNotes(applyResult.releaseNotes)
        : null
      if (stored) setNotes(stored)
      await queryClient.invalidateQueries({ queryKey: UPDATE_STATUS_QUERY_KEY })
      toast(
        desktopDownloaded
          ? `${product.label} downloaded. Ready to install and restart.`
          : applyResult.restartRequired
            ? `${product.label} updated. Restart required.`
            : `${product.label} updated.`,
        {
          type: 'success',
          duration: 7000,
        },
      )
    } catch (err) {
      setPhases((prev) => ({ ...prev, [product.id]: 'error' }))
      setErrors((prev) => ({
        ...prev,
        [product.id]: err instanceof Error ? err.message : String(err),
      }))
    }
  }

  function closeNotes() {
    if (notes) localStorage.setItem(NOTES_SEEN_KEY, notes.id)
    setNotes(null)
  }

  return (
    <>
      <ReleaseNotes notes={notes} onClose={closeNotes} />
      <AnimatePresence>
        {visibleProducts.length ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-5 right-5 z-[9998] flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-2xl"
            style={{ background: 'var(--theme-accent)' }}
            aria-label={`Open updates (${visibleProducts.length} available)`}
          >
            <HugeiconsIcon icon={ArrowUp02Icon} size={17} strokeWidth={2} />
            {visibleProducts.length === 1
              ? 'Update available'
              : `${visibleProducts.length} updates`}
          </motion.button>
        ) : null}
      </AnimatePresence>
      <UpdateDialog
        open={open}
        products={visibleProducts}
        phases={phases}
        errors={errors}
        isFetching={isFetching}
        onClose={() => setOpen(false)}
        onRefresh={() => void refetch()}
        onDismiss={dismiss}
        onUpdate={(product) => void update(product)}
      />
    </>
  )
}

function UpdateDialog({
  open,
  products,
  phases,
  errors,
  isFetching,
  onClose,
  onRefresh,
  onDismiss,
  onUpdate,
}: {
  open: boolean
  products: Array<ProductUpdateStatus>
  phases: Record<ProductId, Phase>
  errors: Record<ProductId, string>
  isFetching: boolean
  onClose: () => void
  onRefresh: () => void
  onDismiss: (product: ProductUpdateStatus) => void
  onUpdate: (product: ProductUpdateStatus) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-center-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: 'var(--theme-card)',
          border: '1px solid var(--theme-border)',
        }}
      >
        <div
          className="flex items-center gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--theme-border)' }}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="update-center-title"
              className="font-semibold"
              style={{ color: 'var(--theme-text)' }}
            >
              Update Center
            </h2>
            <p className="text-sm" style={{ color: 'var(--theme-muted)' }}>
              Review each product before applying an update.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{
              background: 'var(--theme-card2)',
              color: 'var(--theme-text)',
            }}
          >
            {isFetching ? 'Checking…' : 'Check again'}
          </button>
          <button
            type="button"
            onClick={onClose}
            ref={closeRef}
            className="rounded-lg p-2"
            aria-label="Close Update Center"
            style={{ color: 'var(--theme-muted)' }}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
          </button>
        </div>
        <div className="max-h-[70vh] space-y-3 overflow-auto p-4">
          {products.length ? (
            products.map((product) => (
              <UpdateCard
                key={product.id}
                product={product}
                phase={phases[product.id]}
                error={errors[product.id]}
                onDismiss={() => onDismiss(product)}
                onUpdate={() => onUpdate(product)}
              />
            ))
          ) : (
            <p
              className="p-6 text-center text-sm"
              style={{ color: 'var(--theme-muted)' }}
            >
              No updates available.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function UpdateCard({
  product,
  phase,
  error,
  onDismiss,
  onUpdate,
}: {
  product: ProductUpdateStatus
  phase: Phase
  error: string
  onDismiss: () => void
  onUpdate: () => void
}) {
  const updating = phase === 'updating'
  const blocked = product.updateAvailable && !product.canUpdate
  const subtitle =
    phase === 'error'
      ? error
      : blocked
        ? product.reason || 'Update requires manual review.'
        : product.installKind === 'desktop'
          ? `${product.version} → ${productVersionLabel(product)} · desktop`
          : `${shortSha(product.currentHead)} → ${shortSha(product.latestHead)} · ${product.installKind}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="pointer-events-auto overflow-hidden rounded-2xl shadow-2xl"
      style={{
        background: 'var(--theme-card)',
        border: '1px solid var(--theme-border)',
        color: 'var(--theme-text)',
        boxShadow: 'var(--theme-shadow-3)',
      }}
    >
      {updating ? (
        <div
          className="h-0.5 animate-pulse"
          style={{ background: 'var(--theme-accent)' }}
        />
      ) : null}
      <div className="flex items-center gap-3 px-5 py-3.5">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            blocked || phase === 'error' ? 'bg-amber-500/15' : '',
          )}
          style={
            !blocked && phase !== 'error'
              ? {
                  background:
                    'color-mix(in srgb, var(--theme-accent) 14%, transparent)',
                }
              : undefined
          }
        >
          <HugeiconsIcon
            icon={
              updating
                ? Loading03Icon
                : phase === 'done'
                  ? Tick01Icon
                  : ArrowUp02Icon
            }
            size={18}
            strokeWidth={2}
            className={updating ? 'animate-spin' : undefined}
            style={{
              color:
                blocked || phase === 'error'
                  ? '#f59e0b'
                  : 'var(--theme-accent)',
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-sm font-semibold"
            style={{ color: 'var(--theme-text)' }}
          >
            {blocked
              ? `${product.label} update blocked`
              : `${product.label} update available`}
          </p>
          {/* Don't truncate when blocked — the full reason is what the
              user needs to act on. See #293. */}
          <p
            className={cn('text-xs', blocked ? '' : 'truncate')}
            style={{ color: 'var(--theme-muted)' }}
          >
            {subtitle}
          </p>
          {blocked && product.repoPath ? (
            <p
              className="mt-0.5 truncate font-mono text-[11px]"
              style={{ color: 'var(--theme-muted)' }}
              title={product.repoPath}
            >
              {product.repoPath}
            </p>
          ) : null}
          {blocked &&
          product.blockingFiles &&
          product.blockingFiles.length > 0 ? (
            <ul className="mt-1 max-h-24 overflow-auto pr-1">
              {product.blockingFiles.slice(0, 8).map((file) => (
                <li
                  key={file}
                  className="truncate font-mono text-[11px]"
                  style={{ color: 'var(--theme-muted)' }}
                  title={file}
                >
                  {file}
                </li>
              ))}
              {product.blockingFiles.length > 8 ? (
                <li
                  className="text-[11px] italic"
                  style={{ color: 'var(--theme-muted)' }}
                >
                  …and {product.blockingFiles.length - 8} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {product.canUpdate ? (
            <button
              type="button"
              onClick={onUpdate}
              disabled={updating}
              className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: 'var(--theme-accent)' }}
            >
              {updating
                ? product.updateMode === 'hermes-strict'
                  ? 'Refreshing & restarting'
                  : 'Updating'
                : product.updateMode === 'desktop-install-ready'
                  ? 'Install & restart'
                  : product.installKind === 'desktop'
                    ? 'Download'
                    : 'Update'}
            </button>
          ) : (
            <span
              className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
              style={{
                background: 'var(--theme-card2)',
                color: 'var(--theme-muted)',
              }}
              title={product.reason ?? undefined}
              aria-label={`${product.label} update blocked`}
            >
              Blocked
            </span>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
            style={{ color: 'var(--theme-muted)' }}
            aria-label={`Dismiss ${product.label} update`}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function ReleaseNotes({
  notes,
  onClose,
}: {
  notes: Notes | null
  onClose: () => void
}) {
  if (!notes) return null
  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-start justify-center bg-black/45 px-4 pt-[calc(var(--titlebar-h,0px)+1.5rem)] backdrop-blur-sm sm:items-center sm:pt-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          style={{
            background: 'var(--theme-card)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            boxShadow: 'var(--theme-shadow-3)',
          }}
        >
          <div className="flex items-start gap-3 px-5 py-4">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl"
              style={{
                background:
                  'color-mix(in srgb, var(--theme-accent) 14%, transparent)',
              }}
            >
              <HugeiconsIcon
                icon={Tick01Icon}
                size={20}
                strokeWidth={2}
                style={{ color: 'var(--theme-accent)' }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold">Hermes updated</p>
              <p className="text-sm" style={{ color: 'var(--theme-muted)' }}>
                What changed in this update.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 transition-opacity hover:opacity-80"
              style={{ color: 'var(--theme-muted)' }}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-4 overflow-auto px-5 pb-5">
            {notes.sections.map((section) => (
              <section key={`${section.product}:${section.to}`}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{section.label}</h3>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{
                      background: 'var(--theme-card2)',
                      color: 'var(--theme-muted)',
                    }}
                  >
                    {shortSha(section.from)} → {shortSha(section.to)}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {(section.commits.length
                    ? section.commits
                    : ['Updated to the latest available version.']
                  ).map((commit, index) => (
                    <li
                      key={`${section.product}-${index}-${commit}`}
                      className="rounded-xl px-3 py-2 text-sm"
                      style={{ background: 'var(--theme-card2)' }}
                    >
                      {commit}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div
            className="flex justify-end border-t px-5 py-3"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ background: 'var(--theme-accent)' }}
            >
              Continue
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
