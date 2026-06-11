import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ErrorBoundaryProps = {
  children: ReactNode
  className?: string
  title?: string
  description?: string
  /**
   * Compact fallback for non-critical UI regions (side panels, widgets):
   * small card with Retry instead of the full-page error state, so a crash
   * in a decorative subtree never takes down the screen around it.
   */
  inline?: boolean
}

type ErrorBoundaryState = {
  error: Error | null
  componentStack: string | null
}

const CRASH_LOG_KEY = 'hermes:ui-crash-log'
const CRASH_LOG_MAX = 3

type CrashRecord = {
  at: string
  url: string
  message: string
  componentStack: string
  stack: string
}

/**
 * Persist crash details across the reload the user is about to do, so
 * intermittent crashes (e.g. "Too many re-renders") can be diagnosed after
 * the fact. Read back via: JSON.parse(localStorage.getItem('hermes:ui-crash-log'))
 */
function persistCrash(error: Error, errorInfo: ErrorInfo) {
  if (typeof window === 'undefined') return
  try {
    const record: CrashRecord = {
      at: new Date().toISOString(),
      url: window.location.href,
      message: error.message,
      componentStack: errorInfo.componentStack ?? '',
      stack: (error.stack ?? '').split('\n').slice(0, 12).join('\n'),
    }
    const prior: CrashRecord[] = JSON.parse(
      window.localStorage.getItem(CRASH_LOG_KEY) ?? '[]',
    )
    window.localStorage.setItem(
      CRASH_LOG_KEY,
      JSON.stringify([record, ...prior].slice(0, CRASH_LOG_MAX)),
    )
  } catch {
    // storage full or unavailable — diagnostics only, never break the boundary
  }
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    componentStack: null,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error', error, errorInfo.componentStack)
    persistCrash(error, errorInfo)
    this.setState({ componentStack: errorInfo.componentStack ?? null })
  }

  reloadPage() {
    if (typeof window === 'undefined') return
    window.location.reload()
  }

  reset() {
    this.setState({ error: null, componentStack: null })
  }

  copyDetails() {
    if (typeof window === 'undefined' || !this.state.error) return
    const text = [
      this.state.error.message,
      '',
      'Component stack:',
      this.state.componentStack ?? '(unavailable)',
      '',
      'JS stack:',
      this.state.error.stack ?? '',
    ].join('\n')
    void navigator.clipboard?.writeText(text)
  }

  render() {
    if (!this.state.error) return this.props.children

    if (this.props.inline) {
      return (
        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl border border-primary-200 bg-primary-100 p-4 text-center',
            this.props.className,
          )}
        >
          <p className="text-sm font-medium text-primary-900">
            {this.props.title ?? 'This panel crashed'}
          </p>
          <p className="text-xs text-primary-600">
            {this.props.description ??
              'The rest of the page is unaffected. Details saved to the crash log.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => this.reset()}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => this.copyDetails()}>
              Copy details
            </Button>
          </div>
        </div>
      )
    }

    const title = this.props.title ?? 'Something went wrong'
    const description =
      this.props.description ??
      'The chat encountered an unexpected issue. Reload to try again.'

    // The component stack names the exact component that crashed — far more
    // useful than the generic react-dom frames in error.stack.
    const componentStackPreview = this.state.componentStack
      ?.split('\n')
      .filter(Boolean)
      .slice(0, 10)
      .join('\n')

    return (
      <div
        className={cn(
          'flex h-full min-h-0 items-center justify-center bg-primary-50 p-6',
          this.props.className,
        )}
      >
        <div className="w-full max-w-md rounded-xl border border-primary-200 bg-primary-100 p-6 text-center shadow-sm">
          <h2 className="text-balance text-xl font-medium text-primary-900">
            {title}
          </h2>
          <p className="mt-2 text-pretty text-sm text-primary-700">
            {description}
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-red-50 p-2 text-left text-[10px] text-red-800">
            {this.state.error.message}
            {componentStackPreview
              ? `\n\nCrashed in:\n${componentStackPreview}`
              : `\n${this.state.error.stack?.split('\n').slice(0, 5).join('\n')}`}
          </pre>
          <p className="mt-2 text-left text-[10px] text-primary-500">
            Full details saved to localStorage["{CRASH_LOG_KEY}"] (survives
            reload).
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => this.reloadPage()}>Reload</Button>
            <Button variant="outline" onClick={() => this.copyDetails()}>
              Copy details
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
