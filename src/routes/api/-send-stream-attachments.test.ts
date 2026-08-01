import { describe, expect, it } from 'vitest'

import { buildMultimodalContent } from './send-stream'

describe('buildMultimodalContent', () => {
  it('puts an attached image into the message sent to Hermes', () => {
    expect(
      buildMultimodalContent('What is in this screenshot?', [
        {
          contentType: 'image/png',
          content: 'aGVsbG8=',
        },
      ]),
    ).toEqual([
      { type: 'text', text: 'What is in this screenshot?' },
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,aGVsbG8=' },
      },
    ])
  })
})
