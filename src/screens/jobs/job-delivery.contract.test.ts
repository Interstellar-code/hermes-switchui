import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('job delivery messaging surface', () => {
  it('shows the shared telegram topic/timeout hint in both create and edit dialogs', () => {
    const createSource = readFileSync(new URL('./create-job-dialog.tsx', import.meta.url), 'utf8')
    const editSource = readFileSync(new URL('./edit-job-dialog.tsx', import.meta.url), 'utf8')

    expect(createSource).toContain('getMessagingDeliveryHint')
    expect(editSource).toContain('getMessagingDeliveryHint')
  })
})
