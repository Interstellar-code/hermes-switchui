/** Shared launch dialog (D10) — used by Conductor New Mission and /workflows. */

export type LaunchDialogStep = 'workflow' | 'inputs' | 'when' | 'confirm'

export interface LaunchDialogProps {
  open: boolean
  /** Header title; defaults to "New mission" (Conductor). /workflows passes "Run workflow". */
  title?: string
  initialWorkflowId?: string
  initialStep?: LaunchDialogStep
  onClose: () => void
  /** Callers select the new run; launching never opens the drawer (D2). */
  onRunLaunched: (runId: string, workflowId: string) => void
}
