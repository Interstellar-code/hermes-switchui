import { Suspense, lazy } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'

const MemoryScreen = lazy(async () => {
  const m = await import('@/screens/memory/memory-screen')
  return { default: m.MemoryScreen }
})

export const Route = createFileRoute('/memory')({
  ssr: false,
  component: function MemoryRoute() {
    usePageTitle('Memory')
    return (
      <Suspense fallback={<MemoryLoading />}>
        <MemoryScreen />
      </Suspense>
    )
  },
})

function MemoryLoading() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-sm text-primary-500 dark:text-neutral-400">
      Loading memory…
    </div>
  )
}
