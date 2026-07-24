// Files v2 — icon set, kind colors, and the SvgIco/FIcon primitives.
// Ported verbatim from the design handoff (paths must match exactly).

const IcoV2 = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  cmd: 'M9 4a2 2 0 1 0 2 2V4zM9 6h6m0 0a2 2 0 1 0-2-2v2zm0 0v6m0 0a2 2 0 1 0 2 2h-2zm0 0H9m0 0a2 2 0 1 1-2 2v-2zm0 0V6',
  chev: 'm9 6 6 6-6 6',
  chevDown: 'm6 9 6 6 6-6',
  fold: 'm9 6-6 6 6 6M21 6h-9M21 12h-6M21 18h-9',
  unfold: 'm15 6 6 6-6 6M3 6h9M3 12h6M3 18h9',
  refresh: 'M4 12a8 8 0 0 1 14-5l3-3M4 4v5h5M20 12a8 8 0 0 1-14 5l-3 3M20 20v-5h-5',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 20V8m0 0-5 5m5-5 5 5M4 4h16',
  dl: 'M12 4v12m0 0-5-5m5 5 5-5M4 20h16',
  copy: 'M8 8h13v13H8zM15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3',
  edit: 'M4 20h4l10-10-4-4L4 16zM14 6l4 4',
  rename: 'M4 7V5h16v2M9 19h6M12 5v14',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  open: 'M14 4h6v6M20 4 10 14M10 6H4v14h14v-6',
  ext: 'M14 4h6v6M20 4 10 14M10 6H4v14h14v-6',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z|M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0',
  raw: 'm9 4-6 8 6 8M15 4l6 8-6 8',
  outline: 'M4 6h6M4 12h10M4 18h8',
  meta: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8v5l3 2',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z',
  folderOpen:
    'M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1M3 7v11a1 1 0 0 0 1 1h14.5a1 1 0 0 0 .95-.68L22 11H6.5a1 1 0 0 0-.95.68z',
  file: 'M6 3h9l4 4v14H6zM14 3v5h5',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.2 1.2 6L12 16.8 6.7 19.5l1.2-6L3.4 9.3l6-.7z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3.5 2',
  sort: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  x: 'M6 6l12 12M18 6 6 18',
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  pin: 'M12 3l1.5 5.5L19 10l-4 3 1 6-4-3.5L8 19l1-6-4-3 5.5-1.5z',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  enter: 'M9 10l-4 4 4 4M5 14h10a4 4 0 0 0 4-4V6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const

export type IconName = keyof typeof IcoV2

export function SvgIco({ name, size = 15 }: { name: IconName; size?: number }) {
  const segments = IcoV2[name].split('|')
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      {segments.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

export function FIcon({
  file,
  size = 15,
}: {
  file: { type: 'file' | 'folder' }
  size?: number
}) {
  return <SvgIco name={file.type === 'folder' ? 'folder' : 'file'} size={size} />
}

export const KIND_LABEL: Record<string, string> = {
  html: 'HTML',
  md: 'MD',
  json: 'JSON',
  yaml: 'YAML',
  code: 'CODE',
  img: 'IMG',
  pdf: 'PDF',
  txt: 'TXT',
}

export const KIND_COLOR: Record<string, string> = {
  html: '#ff8a4f',
  md: '#5fcfff',
  json: '#d6ff5f',
  yaml: '#d6ff5f',
  code: '#00ff41',
  img: '#ff5fa2',
  pdf: '#ff5f6d',
  txt: 'rgba(216,255,227,.58)',
}

/**
 * Maps the `kind` string returned by files-screen's `getEntryKind()` to a
 * KIND_COLOR key. `kind` is either a literal ('folder', 'workspace',
 * 'markdown', 'image') or a raw file extension (from getExt) for
 * code/text files — see getEntryKind in files-screen.tsx.
 */
export function kindColorKey(kind: string): keyof typeof KIND_COLOR | undefined {
  switch (kind) {
    case 'folder':
    case 'workspace':
      return undefined
    case 'markdown':
      return 'md'
    case 'image':
      return 'img'
    case 'html':
      return 'html'
    case 'json':
      return 'json'
    case 'pdf':
      return 'pdf'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'text':
    case 'txt':
      return 'txt'
    default:
      // remaining code extensions (ts, tsx, js, jsx, css, sh, py, env, …)
      // and the 'code' fallback all share the code color.
      return 'code'
  }
}

export function kindColor(kind: string): string | undefined {
  const key = kindColorKey(kind)
  return key ? KIND_COLOR[key] : undefined
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])

/**
 * Derives the KIND_COLOR key straight from a file name (extension based).
 * Used for the type filter and kind-tinted grid icons.
 */
export function fileKindKey(name: string): keyof typeof KIND_COLOR {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (ext === 'md' || ext === 'mdx') return 'md'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXTS.has(ext)) return 'img'
  if (ext === 'txt' || ext === 'text' || ext === 'log' || ext === '') return 'txt'
  return 'code'
}
