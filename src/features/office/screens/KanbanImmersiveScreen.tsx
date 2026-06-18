import type { AgentState } from '@/features/agents/state/store'
import type { CronJobSummary } from '@/lib/cron/types'
import type { TaskBoardCard, TaskBoardStatus } from '@/features/office/tasks/types'

type KanbanImmersiveScreenProps = {
  agents: AgentState[]
  cardsByStatus: Record<TaskBoardStatus, TaskBoardCard[]>
  selectedCard: TaskBoardCard | null | undefined
  activeRuns?: Array<{ runId: string; agentId: string; label: string }>
  cronJobs?: CronJobSummary[]
  cronLoading?: boolean
  cronError?: string | null
  taskCaptureDebug?: unknown
  onCreateCard: () => void
  onMoveCard: (cardId: string, status: TaskBoardStatus) => void
  onSelectCard: (cardId: string | null) => void
  onUpdateCard: (cardId: string, patch: Partial<TaskBoardCard>) => void
  onDeleteCard: (cardId: string) => void
  onRefreshCronJobs: () => void
  onClose: () => void
}

export function KanbanImmersiveScreen(_props: KanbanImmersiveScreenProps) {
  return null
}
