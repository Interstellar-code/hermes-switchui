'use client'

import type * as React from 'react'

import { cn } from '@/lib/utils'

type PreviewCardProps = React.ComponentPropsWithoutRef<'div'>

function PreviewCard({ className, ...props }: PreviewCardProps) {
  return (
    <div
      className={cn('group/preview-card relative inline-block', className)}
      {...props}
    />
  )
}

type PreviewCardTriggerProps = React.ComponentPropsWithoutRef<'div'>

function PreviewCardTrigger({
  className,
  tabIndex,
  ...props
}: PreviewCardTriggerProps) {
  return (
    <div
      className={cn(className)}
      data-slot="preview-card-trigger"
      tabIndex={props['aria-label'] ? (tabIndex ?? 0) : tabIndex}
      {...props}
    />
  )
}

type PreviewCardPopupProps = React.ComponentPropsWithoutRef<'div'> & {
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

function PreviewCardPopup({
  className,
  children,
  align = 'center',
  sideOffset = 6,
  style,
  ...props
}: PreviewCardPopupProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute top-full z-50 hidden w-64 origin-top rounded-lg p-3 text-sm text-pretty opacity-0 shadow-2xs transition-opacity group-hover/preview-card:block group-hover/preview-card:opacity-100 group-focus-within/preview-card:block group-focus-within/preview-card:opacity-100',
        align === 'start' && 'left-0',
        align === 'center' && 'left-1/2 -translate-x-1/2',
        align === 'end' && 'right-0',
        className,
      )}
      data-slot="preview-card-content"
      role="tooltip"
      style={{
        marginTop: sideOffset,
        background: 'var(--theme-card)',
        color: 'var(--theme-text)',
        outlineColor: 'var(--theme-border)',
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export {
  PreviewCard,
  PreviewCard as HoverCard,
  PreviewCardTrigger,
  PreviewCardTrigger as HoverCardTrigger,
  PreviewCardPopup,
  PreviewCardPopup as HoverCardContent,
}
