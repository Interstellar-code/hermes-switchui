import { describe, expect, it } from 'vitest'
import {
  serializeWorkflowYaml,
  slugify,
  toWorkflowDocumentDraft,
} from './wizard-draft'

describe('wizard-draft', () => {
  describe('slugify', () => {
    it('strips .yaml and .yml extensions', () => {
      expect(slugify('workflow.yaml')).toBe('workflow')
      expect(slugify('workflow.yml')).toBe('workflow')
      expect(slugify('My_Workflow.YAML')).toBe('My_Workflow')
      expect(slugify('test-workflow.YML')).toBe('test-workflow')
    })

    it('replaces unsupported characters with hyphens and trims leading/trailing hyphens', () => {
      expect(slugify('  My Awesome Workflow!  ')).toBe('My-Awesome-Workflow')
      expect(slugify('---leading-and-trailing---')).toBe('leading-and-trailing')
      expect(slugify('foo @ bar # baz $')).toBe('foo-bar-baz')
    })

    it('preserves allowed characters (_:.-)', () => {
      expect(slugify('wf_id:v1.0-beta')).toBe('wf_id:v1.0-beta')
    })

    it('limits output to 128 characters', () => {
      const longInput = 'a'.repeat(200)
      const res = slugify(longInput)
      expect(res).toHaveLength(128)
      expect(res).toBe('a'.repeat(128))
    })

    it('handles empty input gracefully', () => {
      expect(slugify('')).toBe('')
      expect(slugify('   ')).toBe('')
    })
  })

  describe('serializeWorkflowYaml round-trip', () => {
    it('round-trips factory-style YAML through toWorkflowDocumentDraft and serializeWorkflowYaml', () => {
      const factoryYaml = `name: Factory Workflow
description: A factory-style production workflow
nodes:
  - id: plan
    phase: Plan
    prompt: Plan execution
  - id: build-job
    phase: Execute
    depends_on:
      - plan
    command: pnpm run build
    skills:
      - typescript
      - build
  - id: human-gate
    phase: Review
    depends_on:
      - build-job
    approval:
      message: Approve to publish artifact
      capture_response: true
  - id: deploy-script
    phase: Deploy
    depends_on:
      - human-gate
    bash: ./scripts/deploy.sh
  - id: health-loop
    phase: Verify
    depends_on:
      - deploy-script
    loop:
      prompt: Poll health endpoint
      until: HEALTHY
      max_iterations: 5
`
      const doc = toWorkflowDocumentDraft(factoryYaml)
      expect(doc).not.toBeNull()
      if (!doc) return

      expect(doc.name).toBe('Factory Workflow')
      expect(doc.description).toBe('A factory-style production workflow')
      expect(doc.nodes).toHaveLength(5)
      expect(doc.nodes[0]?.id).toBe('plan')
      expect(doc.nodes[0]?.type).toBe('prompt')
      expect(doc.nodes[1]?.id).toBe('build-job')
      expect(doc.nodes[1]?.type).toBe('command')
      expect(doc.nodes[2]?.id).toBe('human-gate')
      expect(doc.nodes[2]?.type).toBe('approval')
      expect(doc.nodes[2]?.approval_capture_response).toBe(true)
      expect(doc.nodes[3]?.id).toBe('deploy-script')
      expect(doc.nodes[3]?.type).toBe('bash')
      expect(doc.nodes[4]?.id).toBe('health-loop')
      expect(doc.nodes[4]?.type).toBe('loop')
      expect(doc.nodes[4]?.loop_max_iterations).toBe(5)

      const serialized = serializeWorkflowYaml(doc)
      const roundTrippedDoc = toWorkflowDocumentDraft(serialized)

      expect(roundTrippedDoc).not.toBeNull()
      if (!roundTrippedDoc) return

      expect(roundTrippedDoc.name).toBe(doc.name)
      expect(roundTrippedDoc.description).toBe(doc.description)
      expect(roundTrippedDoc.nodes).toHaveLength(doc.nodes.length)

      for (let i = 0; i < doc.nodes.length; i++) {
        const origNode = doc.nodes[i]
        const rtNode = roundTrippedDoc.nodes[i]
        expect(rtNode.id).toBe(origNode.id)
        expect(rtNode.type).toBe(origNode.type)
        expect(rtNode.phase).toBe(origNode.phase)
        expect(rtNode.depends_on).toEqual(origNode.depends_on)
        expect(rtNode.skills).toBe(origNode.skills)
        if (origNode.type === 'prompt') {
          expect(rtNode.prompt).toBe(origNode.prompt)
        } else if (origNode.type === 'command') {
          expect(rtNode.command).toBe(origNode.command)
        } else if (origNode.type === 'approval') {
          expect(rtNode.approval_message).toBe(origNode.approval_message)
          expect(rtNode.approval_capture_response).toBe(
            origNode.approval_capture_response,
          )
        } else if (origNode.type === 'bash') {
          expect(rtNode.bash).toBe(origNode.bash)
        } else if (origNode.type === 'loop') {
          expect(rtNode.loop_prompt).toBe(origNode.loop_prompt)
          expect(rtNode.loop_until).toBe(origNode.loop_until)
          expect(rtNode.loop_max_iterations).toBe(origNode.loop_max_iterations)
        }
      }
    })
  })
})
