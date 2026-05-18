import { useQueryClient } from '@tanstack/react-query'
import { usePauseAgent, useResumeAgent } from './use-operations-queries'
import type { FocusData } from '../../../server/operations-store'

interface FocusHeroProps {
  data: FocusData
}

export function FocusHero({ data }: FocusHeroProps) {
  const queryClient = useQueryClient()
  const { mutate: pauseAgent, isPending: isPausing } = usePauseAgent()
  const { mutate: resumeAgent, isPending: isResuming } = useResumeAgent()

  const isLive = data.status === 'live'

  function handlePauseResume() {
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agent', data.id] })
      void queryClient.invalidateQueries({ queryKey: ['operations', 'agents'] })
    }
    if (isLive) {
      pauseAgent(data.id, { onSettled: invalidate })
    } else {
      resumeAgent(data.id, { onSettled: invalidate })
    }
  }

  return (
    <div className="focus-hero">
      <div className="av">{data.initials}</div>
      <div>
        <h1>
          {data.name}
          {data.status === 'live' && <span className="live">live</span>}
        </h1>
        <div className="sub">
          {data.role} · routing for <b>{data.workerCount} workers</b> · model{' '}
          <b>{data.model}</b> · profile <b>{data.profile}</b> · {data.toolCount} tools loaded
        </div>
      </div>
      <div className="quick">
        <button>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          open chat
        </button>
        <button>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 12h2M3 12h2M12 3v2M12 19v2" />
          </svg>
          configure
        </button>
        <button onClick={handlePauseResume} disabled={isPausing || isResuming}>
          {isLive ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              {isPausing ? 'pausing…' : 'pause'}
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isResuming ? 'resuming…' : 'resume'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
