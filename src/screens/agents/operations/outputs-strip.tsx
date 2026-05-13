import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { useOperationsOutputs } from './use-operations-queries'
import { OutputsHeader } from './outputs-header'
import { OutputCard } from './output-card'

export function OutputsStrip() {
  const outputsFilter = useOperationsUIStore((s) => s.outputsFilter)
  const { data: outputs = [] } = useOperationsOutputs()

  const filtered =
    outputsFilter === 'all' ? outputs : outputs.filter((o) => o.type === outputsFilter)

  return (
    <>
      <OutputsHeader />
      <div className="out-rail">
        {filtered.map((output) => (
          <OutputCard key={output.id} output={output} />
        ))}
      </div>
    </>
  )
}
