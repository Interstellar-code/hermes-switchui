import { useEffect, useRef, useState } from 'react'
import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { DISPATCH_DATA } from './mock-data'

interface RoutingStep {
  num: number
  agent: string
  desc: string
  conf: string
  variant?: 'warn' | 'ok'
}

interface PreviewData {
  steps: Array<RoutingStep>
  estCost: string
  estTime: string
}

async function fetchPreview(prompt: string, mode: string): Promise<PreviewData> {
  const res = await fetch('/api/operations/dispatch/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, mode }),
  })
  if (!res.ok) throw new Error(`preview: ${res.status}`)
  return res.json() as Promise<PreviewData>
}

export function RoutingPreview() {
  const dispatchDraft = useOperationsUIStore((s) => s.dispatchDraft)
  const dispatchMode = useOperationsUIStore((s) => s.dispatchMode)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!dispatchDraft.trim()) {
      setPreview(null)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      fetchPreview(dispatchDraft, dispatchMode)
        .then(setPreview)
        .catch(() => setPreview(null))
    }, 350)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [dispatchDraft, dispatchMode])

  const { routingPreview } = DISPATCH_DATA

  // Use live preview if available, else static mock
  const steps = preview
    ? preview.steps.map((s) => ({
        num: s.num,
        agent: s.agent,
        desc: s.desc,
        conf: s.conf,
        variant: s.variant,
      }))
    : routingPreview.steps
  const estCost = preview ? preview.estCost : routingPreview.estCost
  const estTime = preview ? preview.estTime : routingPreview.estTime

  return (
    <div className="disp-preview">
      <div className="disp-preview-lbl">routing preview</div>
      {steps.map((step, i) => (
        <div key={step.num}>
          <div className="disp-step">
            <div className="disp-step-num">{step.num}</div>
            <div className="disp-step-who">
              {step.agent}
              <small>{step.desc}</small>
            </div>
            <div
              className={`disp-step-conf${step.variant ? ` disp-step-conf--${step.variant}` : ''}`}
            >
              {step.conf}
            </div>
          </div>
          {i < steps.length - 1 && <div className="disp-arrow">↓</div>}
        </div>
      ))}
      <div className="disp-est">
        <span>
          est. cost <b>{estCost}</b>
        </span>
        <span>
          est. time <b>{estTime}</b>
        </span>
      </div>
    </div>
  )
}
