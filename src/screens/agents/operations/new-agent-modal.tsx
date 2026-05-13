import { useState } from 'react'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { useCreateAgent } from './use-operations-queries'

interface NewAgentModalProps {
  isOpen: boolean
}

export function NewAgentModal({ isOpen }: NewAgentModalProps) {
  const setNewAgentModalOpen = useOperationsUIStore((s) => s.setNewAgentModalOpen)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'orchestrator' | 'worker'>('worker')
  const [task, setTask] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { mutate: createAgent, isPending } = useCreateAgent()

  if (!isOpen) return null

  function handleClose() {
    setNewAgentModalOpen(false)
    setName('')
    setRole('worker')
    setTask('')
    setErrorMsg(null)
  }

  function handleSubmit() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setErrorMsg('Name is required')
      return
    }
    setErrorMsg(null)
    createAgent(
      { name: trimmedName, role, task: task.trim() },
      {
        onSuccess: () => {
          handleClose()
        },
        onError: (err) => {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to create agent')
        },
      },
    )
  }

  return (
    <div className="na-overlay" onClick={handleClose}>
      <div className="na-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="na-head">
          <span className="na-title">New Agent</span>
          <button className="ico-btn na-close" onClick={handleClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="na-body">
          <label className="na-label">
            Name
            <input
              className="na-input"
              placeholder="e.g. falcon"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </label>
          <label className="na-label">
            Role
            <div className="na-seg">
              {(['worker', 'orchestrator'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`na-seg-btn${role === r ? ' na-seg-btn--active' : ''}`}
                  onClick={() => setRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </label>
          <label className="na-label">
            Initial task
            <input
              className="na-input"
              placeholder="e.g. idle · awaiting dispatch"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </label>
        </div>
        {errorMsg && <div className="na-error">{errorMsg}</div>}
        <div className="na-foot">
          <button className="na-btn-cancel" onClick={handleClose}>
            Cancel
          </button>
          <button
            className="na-btn-submit"
            onClick={handleSubmit}
            disabled={isPending || !name.trim()}
          >
            {isPending ? 'Creating…' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
