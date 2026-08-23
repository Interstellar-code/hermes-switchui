import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import type {
  ApplyUpdateResult,
  ProductUpdateStatus,
} from '@/lib/update-center'
import {
  UPDATE_STATUS_QUERY_KEY,
  applyDesktopWorkspaceUpdate,
  fetchUpdateStatus,
  shortSha,
  updateConfirmOptions,
} from '@/lib/update-center'
import { toast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'

export default function SectionUpdates() {
  const queryClient = useQueryClient()
  const { confirm, confirmDialog } = useConfirm()
  const [updating, setUpdating] = useState<string | null>(null)
  const { data, isFetching, refetch, error } = useQuery({
    queryKey: UPDATE_STATUS_QUERY_KEY,
    queryFn: fetchUpdateStatus,
    staleTime: 30 * 60 * 1000,
    retry: false,
  })

  async function apply(product: ProductUpdateStatus) {
    if (!product.canUpdate || updating) return
    if (!(await confirm(updateConfirmOptions(product)))) return
    setUpdating(product.id)
    try {
      const result =
        product.installKind === 'desktop'
          ? await applyDesktopWorkspaceUpdate()
          : await (async () => {
              const response = await fetch(
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
                response,
                result: (await response.json()) as ApplyUpdateResult,
              }
            })()
      const response = 'response' in result ? result.response : null
      const applyResult = 'result' in result ? result.result : result
      if ((response && !response.ok) || !applyResult.ok)
        throw new Error(applyResult.error || `${product.label} update failed`)
      await queryClient.invalidateQueries({ queryKey: UPDATE_STATUS_QUERY_KEY })
      toast(
        applyResult.restartRequired
          ? `${product.label} updated. Restart required.`
          : `${product.label} updated.`,
        {
          type: 'success',
          duration: 7000,
        },
      )
    } catch (updateError) {
      toast(
        updateError instanceof Error ? updateError.message : 'Update failed',
        { type: 'error' },
      )
    } finally {
      setUpdating(null)
    }
  }

  const products = data ? [data.products.workspace, data.products.agent] : []
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Updates</h2>
          <div className="desc">
            Check and update Hermes Switch UI and Hermes Agent.
          </div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>

      {error ? (
        <SettingCard title="Update status">
          <div style={{ padding: 18, color: 'var(--m-danger, var(--theme-danger))' }}>
            Unable to check for updates.
          </div>
        </SettingCard>
      ) : null}
      {products.map((product) => {
        const blocked = product.updateAvailable && !product.canUpdate
        return (
          <SettingCard
            key={product.id}
            title={product.label}
            sub={product.installKind}
          >
            <div
              style={{
                padding: 18,
                display: 'grid',
                gap: 10,
                font: '500 12px var(--m-font-mono, ui-monospace, monospace)',
              }}
            >
              <div style={{ color: 'var(--m-text-faint, var(--theme-muted))' }}>
                Version{' '}
                <b style={{ color: 'var(--m-text, var(--theme-text))' }}>{product.version}</b>
                {product.currentHead ? (
                  <>
                    {' '}
                    · {shortSha(product.currentHead)} →{' '}
                    {shortSha(product.latestHead)}
                  </>
                ) : null}
              </div>
              <div
                style={{ color: blocked ? 'var(--m-warning, var(--theme-warning))' : 'var(--m-text, var(--theme-text))' }}
              >
                {blocked
                  ? product.reason
                  : product.updateAvailable
                    ? 'Update available'
                    : product.reason || 'Up to date'}
              </div>
              {product.blockingFiles?.length ? (
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: 'var(--m-text-faint, var(--theme-muted))',
                  }}
                >
                  {product.blockingFiles.slice(0, 8).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : null}
              {product.canUpdate ? (
                <div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={updating !== null}
                    onClick={() => void apply(product)}
                  >
                    {updating === product.id
                      ? product.updateMode === 'hermes-strict'
                        ? 'Refreshing and restarting…'
                        : 'Updating…'
                      : product.updateMode === 'desktop-install-ready'
                        ? 'Install and restart'
                        : product.installKind === 'desktop'
                          ? 'Download update'
                          : `Update ${product.label}`}
                  </button>
                </div>
              ) : null}
            </div>
          </SettingCard>
        )
      })}
      {confirmDialog}
    </div>
  )
}
