import { useState } from 'react'
import { useCreateMission } from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

interface NewMissionDialogProps {
  open: boolean
  onClose: () => void
}

export function NewMissionDialog({ open, onClose }: NewMissionDialogProps) {
  const goalDraft = useConductorUIStore((s) => s.goalDraft)
  const setGoalDraft = useConductorUIStore((s) => s.setGoalDraft)
  const setFocusedMissionId = useConductorUIStore((s) => s.setFocusedMissionId)
  const [titleDraft, setTitleDraft] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { mutate: createMission, isPending } = useCreateMission()

  if (!open) return null

  const submitDisabled = isPending || (!titleDraft.trim() && !goalDraft.trim())

  function handleSubmit() {
    const title = titleDraft.trim() || goalDraft.trim()
    if (!title) return
    setErrorMsg(null)
    createMission(
      { title, subtitle: goalDraft.trim() || undefined },
      {
        onSuccess: (mission) => {
          setTitleDraft('')
          setGoalDraft('')
          setFocusedMissionId(mission.id)
          onClose()
        },
        onError: (err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to create mission')
        },
      },
    )
  }

  return (
    <div className="nm-overlay" onClick={onClose}>
      <div className="nm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="nm-head">
          <span className="nm-title">New Mission</span>
          <button className="ico-btn nm-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="nm-body">
          <label className="nm-label">
            Mission name
            <input
              className="nm-input"
              placeholder="e.g. Sweep PRs + summarise BenchLoop"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
            />
          </label>
          <label className="nm-label">
            Prompt
            <textarea
              className="nm-textarea"
              rows={4}
              placeholder="Describe what this mission should accomplish…"
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
            />
          </label>
        </div>
        {errorMsg && <div className="nm-error">{errorMsg}</div>}
        <div className="nm-foot">
          <button className="nm-btn-cancel" onClick={onClose}>Cancel</button>
          <button className="nm-btn-submit" onClick={handleSubmit} disabled={submitDisabled}>
            {isPending ? 'Creating…' : 'Create Mission'}
          </button>
        </div>
      </div>
    </div>
  )
}
