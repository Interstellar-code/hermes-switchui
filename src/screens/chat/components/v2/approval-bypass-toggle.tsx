'use client'

/**
 * Per-chat approval bypass ("YOLO") switch — the header affordance for
 * `POST /api/sessions/:key/yolo`.
 *
 * ## Why it lives here and not in the composer or Settings
 *
 * Settings → Safety already owns `config.approvals.mode`, which is **global and
 * persisted**: `manual | smart | off`. This is a different thing — **one chat,
 * this gateway process, until it restarts** — and the two combine by OR, not by
 * precedence (`tools/approval.py`: `if _YOLO_MODE_FROZEN or
 * is_current_session_yolo_enabled() or approval_mode == "off"`). So:
 *
 *   - Global `manual`/`smart` + this ON  → this chat skips prompts, others don't.
 *   - Global `off` + this OFF            → the chat STILL skips prompts. Turning
 *                                          this off does not re-arm approvals;
 *                                          only Settings can.
 *
 * Whichever is more permissive wins, which is why the copy below never promises
 * that switching off restores prompts — it says where the other switch is.
 *
 * ## The states
 *
 * Four, and the third is the point:
 *   - **off** — a quiet shield. Approvals are enforced for this chat.
 *   - **on** — loud and red, labelled, `aria-pressed`. Nobody should be able to
 *     leave a chat in this state without noticing.
 *   - **unknown** — the read failed. It renders as its own state and offers a
 *     retry, because reporting "off" for a state we could not read is exactly
 *     the lie this control exists to avoid.
 *   - **unsupported** — gateway older than hermes-agent 0.19.13. Renders
 *     nothing, like `ApprovalsBell` does with an empty queue.
 *
 * Enabling asks for confirmation; disabling never does — putting a speed bump
 * in front of "make it safer again" is how a safety control gets left on.
 */

import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSessionYolo } from '@/screens/chat/hooks/use-session-yolo'
import { cn } from '@/lib/utils'

export const APPROVAL_BYPASS_CONFIRM_TITLE = 'Skip approvals for this chat?'

export function ApprovalBypassToggle({
  sessionKey,
  className,
}: {
  sessionKey: string | undefined
  className?: string
}) {
  const {
    available,
    enabled,
    unsupported,
    unknown,
    pending,
    error,
    setEnabled,
    refresh,
  } = useSessionYolo(sessionKey)
  const { confirm, confirmDialog } = useConfirm()

  // No gateway session to key on (a `new` chat before its first turn, or
  // portable mode), or a gateway build with no bypass endpoint. Either way a
  // rendered switch would be a switch that does nothing.
  if (!available || unsupported) return null

  async function handleClick() {
    if (unknown) {
      refresh()
      return
    }
    if (enabled) {
      // Turning approvals back on needs no ceremony.
      await setEnabled(false)
      return
    }
    const ok = await confirm({
      title: APPROVAL_BYPASS_CONFIRM_TITLE,
      destructive: true,
      confirmLabel: 'Skip approvals',
      cancelLabel: 'Keep approvals',
      message: (
        <>
          <p>
            Dangerous commands in <strong>this chat</strong> will run with no
            prompt — deletes, force pushes, service restarts, anything the
            approval guard would normally stop.
          </p>
          <p className="mt-2">
            It applies to this chat only, and only until the gateway restarts:
            the bypass is held in memory and is never saved. It does not change
            the global approval mode in Settings → Safety, and switching it back
            off will not re-arm approvals if that mode is already <em>Off</em>.
          </p>
        </>
      ),
    })
    if (!ok) return
    await setEnabled(true)
  }

  const label = unknown
    ? 'Approval bypass state unknown — retry'
    : enabled
      ? 'Approvals are being skipped for this chat. Click to turn them back on.'
      : 'Dangerous-command approvals are on for this chat. Click to skip them.'

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        aria-pressed={unknown ? undefined : enabled}
        aria-label={label}
        title={error ? `${label} — ${error}` : label}
        data-testid="approval-bypass-toggle"
        data-state={unknown ? 'unknown' : enabled ? 'on' : 'off'}
        className={cn(
          'flex min-h-7 shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-all disabled:opacity-60',
          enabled &&
            'border-red-500 bg-red-500/15 text-red-600 hover:bg-red-500/25 dark:text-red-400',
          !enabled &&
            !unknown &&
            'border-transparent text-[var(--theme-muted)] hover:border-[var(--theme-border)] hover:text-[var(--theme-text)]',
          unknown &&
            'border-amber-400/70 bg-amber-400/10 text-amber-600 hover:bg-amber-400/20 dark:text-amber-400',
          className,
        )}
      >
        {unknown ? (
          <ShieldAlert className="size-3.5" aria-hidden />
        ) : enabled ? (
          <ShieldOff className="size-3.5" aria-hidden />
        ) : (
          <ShieldCheck className="size-3.5" aria-hidden />
        )}
        {enabled ? <span>YOLO</span> : null}
        {unknown ? <span>?</span> : null}
      </button>
      {confirmDialog}
    </>
  )
}
