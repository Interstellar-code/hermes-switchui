export async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to execCommand for insecure origins / limited browsers.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard unavailable')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  textarea.style.top = '0'
  textarea.style.left = '0'

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, text.length)

  try {
    const copied = document.execCommand('copy')
    if (!copied) {
      throw new Error('Clipboard unavailable')
    }
  } finally {
    textarea.remove()
  }
}

/**
 * Copy both a rich (text/html) and a plain (text/plain) representation to the
 * clipboard so the content keeps its formatting when pasted into rich editors
 * (e.g. a table stays a table) while remaining usable as plain text elsewhere.
 *
 * Falls back to copying only the plain-text payload on browsers without the
 * async ClipboardItem API.
 */
export async function writeRichTextToClipboard(
  html: string,
  plainText: string,
): Promise<void> {
  if (typeof navigator !== 'undefined' && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      })
      // navigator.clipboard is absent on insecure origins; the throw is caught.
      await navigator.clipboard.write([item])
      return
    } catch {
      // Fall through to plain-text copy below.
    }
  }

  await writeTextToClipboard(plainText)
}
