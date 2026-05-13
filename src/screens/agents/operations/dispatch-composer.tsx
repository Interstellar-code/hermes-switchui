import { useRef, useState } from 'react'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { DISPATCH_DATA } from './mock-data'
import { useDispatch } from './use-operations-queries'

export function DispatchComposer() {
  const dispatchDraft = useOperationsUIStore((s) => s.dispatchDraft)
  const setDispatchDraft = useOperationsUIStore((s) => s.setDispatchDraft)
  const dispatchMode = useOperationsUIStore((s) => s.dispatchMode)

  const [showRibbon, setShowRibbon] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const ribbonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mutation = useDispatch()

  function handleSubmit() {
    if (!dispatchDraft.trim()) return
    setErrorMsg(null)
    mutation.mutate(
      {
        prompt: dispatchDraft,
        mode: dispatchMode,
        priority: 'normal',
        budget: '25k',
        deadline: '30m',
        tags: [],
      },
      {
        onSuccess: () => {
          setDispatchDraft('')
          setShowRibbon(true)
          if (ribbonTimer.current) clearTimeout(ribbonTimer.current)
          ribbonTimer.current = setTimeout(() => setShowRibbon(false), 2500)
        },
        onError: (err: unknown) => {
          setErrorMsg(err instanceof Error ? err.message : 'Dispatch failed')
        },
      },
    )
  }

  const isPending = mutation.isPending

  return (
    <div className="disp-compose">
      {showRibbon && (
        <div className="disp-ribbon disp-ribbon--ok">DISPATCH SENT</div>
      )}
      <textarea
        className="disp-textarea"
        placeholder={DISPATCH_DATA.composerPlaceholder}
        value={dispatchDraft}
        onChange={(e) => setDispatchDraft(e.target.value)}
        disabled={isPending}
      />
      <button
        type="button"
        className="disp-submit"
        disabled={!dispatchDraft.trim() || isPending}
        onClick={handleSubmit}
      >
        {isPending ? 'sending…' : 'dispatch'}
      </button>
      {errorMsg && <div className="disp-error">{errorMsg}</div>}
    </div>
  )
}
