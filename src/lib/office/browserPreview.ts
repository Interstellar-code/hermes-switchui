export type BrowserPreviewSnapshot = Record<string, unknown>
export function shouldPreferBrowserScreenshot(
  _snapshot?: BrowserPreviewSnapshot | string | null,
): boolean {
  return false
}
