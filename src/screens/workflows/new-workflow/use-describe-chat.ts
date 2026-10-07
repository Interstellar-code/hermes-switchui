import { useState } from 'react'
import { chatWorkflowWizard } from '../api-client'
import {
  buildWorkflowFromPrompt,
  slugify,
  toWorkflowDocumentDraft,
} from './wizard-draft'
import type { WizardDocumentDraft } from './wizard-draft'
import type { ChatMessage } from './describe-chat'

export type { ChatMessage }

export const NWZ_CHAT_INIT: Array<ChatMessage> = [
  {
    role: 'assistant',
    msg: "Let's build a new workflow. Describe what you want it to do — the steps it should take, what triggers it, and what the output should look like.",
  },
]

let chatWarnFired = false

export interface DescribeChat {
  chatHistory: Array<ChatMessage>
  chatInput: string
  chatPending: boolean
  wizardSessionId: string | null
  onChatInput: (v: string) => void
  onSend: () => void
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
}

export function useDescribeChat({
  yaml,
  name,
  description,
  id,
  applyParsedDocument,
  setYaml,
}: UseDescribeChatOptions): DescribeChat {
  const [chatHistory, setChatHistory] =
    useState<Array<ChatMessage>>(NWZ_CHAT_INIT)
  const [chatInput, setChatInput] = useState('')
  const [chatPending, setChatPending] = useState(false)
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null)

  async function handleSend() {
    const userMsg = chatInput.trim()
    if (!userMsg || chatPending) return
    setChatHistory((h) => [...h, { role: 'user', msg: userMsg }])
    setChatInput('')
    setChatPending(true)
    try {
      const result = await chatWorkflowWizard({
        sessionId: wizardSessionId ?? undefined,
        message: userMsg,
        currentYaml: yaml,
        currentName: name,
        currentDescription: description,
        history: [...chatHistory, { role: 'user', msg: userMsg }],
      })
      setWizardSessionId(result.sessionId ?? null)
      setChatHistory((h) => [...h, { role: 'assistant', msg: result.reply }])

      const parsed = toWorkflowDocumentDraft(result.workflow_yaml)
      if (parsed) {
        applyParsedDocument(parsed, {
          wizardId:
            id ||
            result.suggested_id ||
            slugify(result.suggested_name || name || 'workflow'),
          forceName: result.suggested_name || parsed.name || name || 'Workflow',
          forceDescription:
            result.suggested_description || parsed.description || description,
        })
      } else {
        setYaml(result.workflow_yaml)
      }
    } catch (err) {
      // Warn once per session so future debugging is easier; fallback builds a local draft.
      if (!chatWarnFired) {
        chatWarnFired = true
        console.warn(
          '[workflow-wizard] Hermes scratch chat failed — using local fallback',
          err,
        )
      }
      const fallbackDoc = buildWorkflowFromPrompt(
        userMsg,
        name || 'My Workflow',
      )
      applyParsedDocument(fallbackDoc, {
        wizardId: id || slugify(fallbackDoc.name || userMsg || 'workflow'),
        forceName: fallbackDoc.name || name || 'Workflow',
        forceDescription: fallbackDoc.description || description,
      })
      setChatHistory((h) => [
        ...h,
        {
          role: 'assistant',
          msg: 'I could not reach the live Hermes chat service for this turn, so I created a local workflow draft from your message. Review the DAG in Step 2, refine nodes in Step 3, or tell me more about the trigger, steps, and expected output.',
        },
      ])
    } finally {
      setChatPending(false)
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
  }
}
