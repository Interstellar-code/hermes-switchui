export function DocsRenderer({ html }: { html: string }) {
  return (
    <div
      className="docs-content max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
