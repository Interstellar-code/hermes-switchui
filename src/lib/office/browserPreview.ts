export type BrowserPreviewSnapshot = Record<string, unknown>
export function shouldPreferBrowserScreenshot(_snapshot?: BrowserPreviewSnapshot | null): boolean { return false }
