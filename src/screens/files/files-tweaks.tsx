// Files v2 — Tweaks panel: accent/density/labels/quick-access controls.
// Ported from the design handoff (HANDOFF-tweaks-spy.txt), adapted to typed
// props. Persistence (localStorage key `files.tweaks`) lives in the caller,
// files-screen.tsx — this component is presentation-only.
import { SvgIco } from './files-icons'
import { cn } from '@/lib/utils'

const ACCENTS: Array<[string, string]> = [
  ['#00ff41', 'green'],
  ['#5fcfff', 'cyan'],
  ['#d6ff5f', 'lime'],
  ['#ff8a4f', 'amber'],
]

const DENSITY_OPTS: Array<[string, string]> = [
  ['7px', 'Comfortable'],
  ['4px', 'Compact'],
]

const LABEL_OPTS: Array<[string, string]> = [
  ['on', 'Labels'],
  ['off', 'Icons'],
]

const QA_OPTS: Array<[boolean, string]> = [
  [true, 'Show'],
  [false, 'Hide'],
]

type FilesTweaksProps = {
  open: boolean
  setOpen: (open: boolean) => void
  accent: string
  setAccent: (value: string) => void
  density: string
  setDensity: (value: string) => void
  labels: string
  setLabels: (value: string) => void
  showQA: boolean
  setShowQA: (value: boolean) => void
}

export function FilesTweaks({
  open,
  setOpen,
  accent,
  setAccent,
  density,
  setDensity,
  labels,
  setLabels,
  showQA,
  setShowQA,
}: FilesTweaksProps) {
  if (!open) {
    return (
      <button
        type="button"
        className="tw-fab"
        title="Tweaks"
        onClick={() => setOpen(true)}
      >
        <SvgIco name="meta" size={18} />
      </button>
    )
  }

  return (
    <div className="tw-panel">
      <h4>
        Tweaks
        <button
          type="button"
          className="x"
          onClick={() => setOpen(false)}
          aria-label="Close tweaks"
        >
          <SvgIco name="x" size={14} />
        </button>
      </h4>
      <div className="tw-row">
        <div className="l">Accent</div>
        <div className="swatches">
          {ACCENTS.map(([c, n]) => (
            <span
              key={c}
              className={cn('sw', accent === c ? 'on' : '')}
              style={{ background: c }}
              title={n}
              onClick={() => setAccent(c)}
            />
          ))}
        </div>
      </div>
      <div className="tw-row">
        <div className="l">Row density</div>
        <div className="seg">
          {DENSITY_OPTS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={density === v ? 'on' : ''}
              onClick={() => setDensity(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="tw-row">
        <div className="l">Action buttons</div>
        <div className="seg">
          {LABEL_OPTS.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={labels === v ? 'on' : ''}
              onClick={() => setLabels(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="tw-row">
        <div className="l">Quick access</div>
        <div className="seg">
          {QA_OPTS.map(([v, l]) => (
            <button
              key={String(v)}
              type="button"
              className={showQA === v ? 'on' : ''}
              onClick={() => setShowQA(v)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
