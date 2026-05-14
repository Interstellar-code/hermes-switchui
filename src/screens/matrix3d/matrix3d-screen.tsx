import { Matrix3DCanvas } from './components/matrix3d-canvas'

export function Matrix3DScreen() {
  return (
    <div className="flex h-full flex-col overflow-auto bg-[var(--theme-bg)] text-[var(--theme-text)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col p-4 md:p-6">
        <section className="min-h-0 flex-1">
          <div className="h-[calc((100dvh-96px)*0.5)] min-h-[360px] overflow-hidden rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)]">
            <Matrix3DCanvas />
          </div>
        </section>
      </div>
    </div>
  )
}
