import { memo, useEffect, useState } from 'react'
import { FileText, X } from 'lucide-react'
import type { ChatComposerAttachment } from './chat-composer-types'
import { cn } from '@/lib/utils'

export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const formatted =
    value % 1 === 0 || value >= 100
      ? value.toFixed(0)
      : value.toFixed(1).replace(/\.0$/, '')
  return `${formatted} ${units[unitIndex]}`
}

export function attachmentBadge(name?: string, contentType?: string): string {
  if (name) {
    const ext = name.split('.').pop()?.trim().toUpperCase()
    if (ext && ext.length <= 5 && !ext.includes(' ')) {
      return ext
    }
  }
  if (contentType) {
    const sub = contentType.split('/')[1]?.split(';')[0]?.trim().toUpperCase()
    if (sub) {
      if (sub === 'JPEG') return 'JPG'
      if (sub.length <= 5) return sub
    }
  }
  return 'FILE'
}

type ImageDimensions = {
  width: number
  height: number
}

function useImageDimensions(src?: string): ImageDimensions | null {
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)

  useEffect(() => {
    if (!src || typeof window === 'undefined') {
      setDimensions(null)
      return
    }

    let active = true
    const img = new Image()
    img.onload = () => {
      if (active && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setDimensions({ width: img.naturalWidth, height: img.naturalHeight })
      }
    }
    img.onerror = () => {
      if (active) setDimensions(null)
    }
    img.src = src

    return () => {
      active = false
    }
  }, [src])

  return dimensions
}

export type ComposerAttachmentChipProps = {
  attachment: ChatComposerAttachment
  onRemove: (id: string) => void
}

export const ComposerAttachmentChip = memo(function ComposerAttachmentChip({
  attachment,
  onRemove,
}: ComposerAttachmentChipProps) {
  const isImage =
    attachment.kind === 'image' ||
    attachment.contentType.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(attachment.name)

  const imageSrc = attachment.previewUrl || attachment.dataUrl
  const dimensions = useImageDimensions(isImage ? imageSrc : undefined)
  const badge = attachmentBadge(attachment.name, attachment.contentType)
  const formattedSize = attachment.size ? formatFileSize(attachment.size) : ''

  return (
    <div
      role="group"
      aria-label={`Attachment: ${attachment.name}`}
      data-testid="composer-attachment-chip"
      className="group/att relative inline-flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] p-1.5 pr-2 text-xs text-[var(--theme-text)] shadow-xs transition-all hover:border-[var(--theme-accent)]/50 shrink-0 select-none max-w-[280px]"
    >
      {/* Thumbnail or Badge */}
      {isImage && imageSrc ? (
        <div className="relative size-8 shrink-0 overflow-hidden rounded bg-[var(--theme-card2)] border border-[var(--theme-border)]/50">
          <img
            src={imageSrc}
            alt={attachment.name}
            className="size-full object-cover"
          />
        </div>
      ) : (
        <div className="flex size-8 shrink-0 flex-col items-center justify-center rounded border border-[var(--theme-border)]/60 bg-[var(--theme-card2)] font-mono text-[9px] font-bold text-[var(--theme-accent)] tracking-wider">
          <FileText className="size-3 opacity-60 mb-0.5" />
          <span>{badge}</span>
        </div>
      )}

      {/* Meta */}
      <div className="flex flex-col min-w-0 pr-1">
        <span className="truncate font-medium text-[12px] leading-tight text-[var(--theme-text)]">
          {attachment.name}
        </span>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--theme-muted)] leading-normal mt-0.5">
          {dimensions ? (
            <span>
              {dimensions.width}×{dimensions.height}
            </span>
          ) : (
            <span className="uppercase">{badge}</span>
          )}
          {formattedSize && (
            <>
              <span className="opacity-40">·</span>
              <span>{formattedSize}</span>
            </>
          )}
        </div>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(attachment.id)}
        aria-label={`Remove ${attachment.name}`}
        className="ml-auto rounded-full p-1 text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:bg-[var(--theme-card2)] transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
})

export type ComposerAttachmentTrayProps = {
  attachments: Array<ChatComposerAttachment>
  onRemove: (id: string) => void
  className?: string
}

export const ComposerAttachmentTray = memo(function ComposerAttachmentTray({
  attachments,
  onRemove,
  className,
}: ComposerAttachmentTrayProps) {
  if (attachments.length === 0) return null

  return (
    <div
      data-testid="composer-attachment-tray"
      className={cn(
        'flex items-center gap-2 overflow-x-auto py-1 px-1 scrollbar-none',
        className,
      )}
    >
      {attachments.map((att) => (
        <ComposerAttachmentChip
          key={att.id}
          attachment={att}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
})
