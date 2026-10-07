import { useState } from 'react'
import { chatWorkflowWizard, createWorkflowDraftSession } from '../api-client'
import { slugify, toWorkflowDocumentDraft } from './wizard-draft'
import { diffWorkflowYaml } from './draft-diff'
import { yamlToParsedWorkflow } from './yaml-lint'
import type { WizardDocumentDraft } from './wizard-draft'
import type { DraftDiffResult } from './draft-diff'
import type { ParsedWorkflow } from '../types'
import type { ChatMessage } from './describe-chat'

export type { ChatMessage }

export const NWZ_CHAT_INIT: Array<ChatMessage> = [
  {
    role: 'assistant',
    msg: "Let's build a new workflow. Describe what you want it to do — the steps it should take, what triggers it, and what the output should look like.",
  },
]

export interface DraftRevision {
  revision: number
  yaml: string
  diff: DraftDiffResult
  parsed: ParsedWorkflow | null
  suggestedId?: string
  suggestedName?: string
  suggestedDescription?: string
  timestamp: number
}

export interface DescribeChat {
  chatHistory: Array<ChatMessage>
  chatInput: string
  chatPending: boolean
  wizardSessionId: string | null
  onChatInput: (v: string) => void
  onSend: () => void
  revisions: Array<DraftRevision>
  currentRevision: number
  selectedRevision: number
  onSelectRevision: (rev: number) => void
  onUseDraft: (rev?: number) => void
  unavailable: boolean
  errorMessage: string | null
  onSwitchToTemplate?: () => void
}

export interface UseDescribeChatOptions {
  yaml: string
  name: string
  description: string
  id: string
  applyParsedDocument: (
    doc: WizardDocumentDraft,
    options?: {
      wizardId?: string
      forceName?: string
      forceDescription?: string
    },
  ) => void
  setYaml: (yaml: string) => void
  onSwitchToTemplate?: () => void
}

export function useDescribeChat({
  yaml,
  name,
  description,
  id,
  applyParsedDocument,
  setYaml,
  onSwitchToTemplate,
}: UseDescribeChatOptions): DescribeChat {
  const [chatHistory, setChatHistory] =
    useState<Array<ChatMessage>>(NWZ_CHAT_INIT)
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<Array<DraftRevision>>([])
  const [selectedRevision, setSelectedRevision] = useState<number>(0)
  const [unavailable, setUnavailable] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleSend() {
    const userMsg = chatInput.trim()
    if (!userMsg || chatPending) return
    setChatHistory((h) => [...h, { role: 'user', msg: userMsg }])
    setChatInput('')
    setChatPending(true)
    setUnavailable(false)
    setErrorMessage(null)

    let sid = wizardSessionId
    try {
      if (!sid) {
        const sessionRes = await createWorkflowDraftSession(name)
        sid = sessionRes.sessionId
        setWizardSessionId(sid)
      }

      const activeYaml =
        revisions.length > 0 ? revisions[revisions.length - 1].yaml : yaml

      const result = await chatWorkflowWizard({
        sessionId: sid,
        message: userMsg,
        currentYaml: activeYaml,
        currentName: name,
        currentDescription: description,
        history: [...chatHistory, { role: 'user', msg: userMsg }],
      })

      if (result.sessionId) {
        setWizardSessionId(result.sessionId)
      }
      setChatHistory((h) => [...h, { role: 'assistant', msg: result.reply }])

      if (result.workflow_yaml) {
        const prevYaml =
          revisions.length > 0 ? revisions[revisions.length - 1].yaml : null
        const diff = diffWorkflowYaml(prevYaml, result.workflow_yaml)
        const newRevNum = revisions.length + 1
        const nextRev: DraftRevision = {
          revision: newRevNum,
          yaml: result.workflow_yaml,
          diff,
          parsed: yamlToParsedWorkflow(result.workflow_yaml),
          suggestedId: result.suggested_id,
          suggestedName: result.suggested_name,
          suggestedDescription: result.suggested_description,
          timestamp: Date.now(),
        }
        setRevisions((prev) => [...prev, nextRev])
        setSelectedRevision(newRevNum)

        const parsedDoc = toWorkflowDocumentDraft(result.workflow_yaml)
        if (parsedDoc) {
          applyParsedDocument(parsedDoc, {
            wizardId:
              id ||
              result.suggested_id ||
              slugify(result.suggested_name || name || 'workflow'),
            forceName:
              result.suggested_name || parsedDoc.name || name || 'Workflow',
            forceDescription:
              result.suggested_description ||
              parsedDoc.description ||
              description,
          })
        } else {
          setYaml(result.workflow_yaml)
        }
      }
    } catch (err) {
      console.warn('[workflow-wizard] Describe chat turn failed', err)
      setUnavailable(true)
      setErrorMessage('AI drafting unavailable — start from a template')
    } finally {
      setChatPending(false)
    }
  }

  function handleUseDraft(targetRev?: number) {
    if (revisions.length === 0) return
    const revNum = targetRev ?? selectedRevision
    const rev =
      revisions.find((r) => r.revision === revNum) ??
      revisions[revisions.length - 1]
    const parsedDoc = toWorkflowDocumentDraft(rev.yaml)
    if (parsedDoc) {
      applyParsedDocument(parsedDoc, {
        wizardId:
          id ||
          rev.suggestedId ||
          slugify(rev.suggestedName || name || 'workflow'),
        forceName: rev.suggestedName || parsedDoc.name || name || 'Workflow',
        forceDescription:
          rev.suggestedDescription || parsedDoc.description || description,
      })
    } else {
      setYaml(rev.yaml)
    }
  }

  return {
    chatHistory,
    chatInput,
    chatPending,
    wizardSessionId,
    onChatInput: setChatInput,
    onSend: () => {
      void handleSend()
    },
    revisions,
    currentRevision: revisions.length,
    selectedRevision,
    onSelectRevision: setSelectedRevision,
    onUseDraft: handleUseDraft,
    unavailable,
    errorMessage,
    onSwitchToTemplate,
  }
}
