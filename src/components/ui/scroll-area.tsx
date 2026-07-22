'use client'

import type * as React from 'react'

import { cn } from '@/lib/utils'

type ScrollAreaRootProps = React.ComponentPropsWithoutRef<'div'>

function ScrollAreaRoot({ className, ...props }: ScrollAreaRootProps) {
  return (
    <div
      className={cn(
        'group/scroll-area relative outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaViewportProps = React.ComponentPropsWithoutRef<'div'>

function ScrollAreaViewport({ className, ...props }: ScrollAreaViewportProps) {
  return (
    <div
      className={cn(
        'h-full w-full overflow-auto outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaScrollbarProps = React.ComponentPropsWithoutRef<'div'> & {
  orientation?: 'horizontal' | 'vertical'
}

function ScrollAreaScrollbar(_: ScrollAreaScrollbarProps) {
  return null
}

type ScrollAreaThumbProps = React.ComponentPropsWithoutRef<'div'>

function ScrollAreaThumb(_: ScrollAreaThumbProps) {
  return null
}

type ScrollAreaCornerProps = React.ComponentPropsWithoutRef<'div'>

function ScrollAreaCorner(_: ScrollAreaCornerProps) {
  return null
}

export {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
}
