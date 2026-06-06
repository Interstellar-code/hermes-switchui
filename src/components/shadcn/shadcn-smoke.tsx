import { Check } from 'lucide-react'

import { Button } from '@/components/shadcn/ui/button'

export function ShadcnSmoke() {
  return (
    <div
      data-testid="shadcn-smoke"
      className="rounded-lg border border-border bg-background p-3 text-foreground ring-ring"
    >
      <Button type="button">
        <Check aria-hidden="true" />
        shadcn smoke
      </Button>
    </div>
  )
}
