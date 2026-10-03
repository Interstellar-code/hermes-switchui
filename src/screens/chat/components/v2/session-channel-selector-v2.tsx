import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Loader2, Send } from 'lucide-react'
import type {
  ChannelPlatform,
  ChannelTarget,
} from '@/routes/api/sessions/$sessionKey.channel'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/shadcn/ui/popover'
import { toast } from '@/components/ui/toast'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'
import { formatHomeChannelLabel } from '@/lib/messaging-channel-label'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

type ChannelSession = {
  source: string | null
  chat_id: string | null
  thread_id: string | null
  title: string | null
  handoff_state: string | null
  handoff_platform: string | null
  handoff_error: string | null
  handoff_requested_at: number | null
}

type ChannelResponse = {
  ok: boolean
  profile?: string
  session?: ChannelSession | null
  platforms?: Array<ChannelPlatform>
  targets?: Array<ChannelTarget>
  error?: string
}

const IN_FLIGHT = new Set(['pending', 'running'])
/** Gateway drops a pending handoff after ~10 min; stop polling past that. */
const STALE_AFTER_S = 600

type Confirming = { platform: ChannelPlatform; target: ChannelTarget | null }

function isStale(session: ChannelSession | null | undefined): boolean {
  const at = session?.handoff_requested_at
  return Boolean(at) && Date.now() / 1000 - at! > STALE_AFTER_S
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function channelUrl(sessionKey: string, profile: string | null): string {
  const q = profile ? `?profile=${encodeURIComponent(profile)}` : ''
  return `/api/sessions/${encodeURIComponent(sessionKey)}/channel${q}`
}

export function SessionChannelSelectorV2({
  sessionKey,
}: {
  sessionKey: string | null | undefined
}) {
  const profile = useResolvedProfile()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState<Confirming | null>(null)
  const [filter, setFilter] = React.useState('')
  const lastTarget = React.useRef<string | null>(null)
  const key = sessionKey && sessionKey !== 'new' ? sessionKey : null
  const queryKey = ['session-channel', profile ?? '', key ?? '']

  const query = useQuery({
    queryKey,
    enabled: Boolean(key),
    queryFn: async (): Promise<ChannelResponse> => {
      const res = await fetch(channelUrl(key!, profile))
      const body = (await res.json().catch(() => ({}))) as ChannelResponse
      // Throw so polling keeps the last good data instead of blanking the chip.
      if (!res.ok || !body.ok)
        throw new Error(body.error || `HTTP ${res.status}`)
      return body
    },
    refetchInterval: (q) => {
      const s = q.state.data?.session
      return IN_FLIGHT.has(s?.handoff_state ?? '') && !isStale(s) ? 2000 : false
    },
  })

  const session = query.data?.session ?? null
  const handoffState = session?.handoff_state ?? null

  // Toast once when a handoff we watched in flight settles.
  const prevState = React.useRef(handoffState)
  React.useEffect(() => {
    const prev = prevState.current
    prevState.current = handoffState
    if (!prev || !IN_FLIGHT.has(prev) || IN_FLIGHT.has(handoffState ?? ''))
      return
    if (handoffState === 'completed')
      toast(
        lastTarget.current
          ? `Session continued in '${lastTarget.current}'`
          : 'Session continued in a new topic',
        { type: 'success' },
      )
    else if (handoffState === 'failed')
      toast(`Handoff failed: ${session?.handoff_error ?? 'unknown error'}`, {
        type: 'error',
      })
  }, [handoffState, session?.handoff_error])

  const handoff = useMutation({
    mutationFn: async ({ platform, target }: Confirming) => {
      const res = await fetch(channelUrl(key!, profile), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: platform.id, target: target?.target }),
      })
      const body = (await res.json()) as ChannelResponse
      if (!res.ok || !body.ok)
        throw new Error(body.error || `HTTP ${res.status}`)
      return body
    },
    onSuccess: (_body, vars) => {
      lastTarget.current = vars.target?.label ?? null
      setConfirming(null)
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey })
    },
    onError: (err) => {
      toast(err instanceof Error ? err.message : String(err), { type: 'error' })
    },
  })

  // Brand-new chat (no state.db row yet): nothing to hand off.
  if (!key || !session) return null

  const platforms = query.data?.platforms ?? []
  const targets = query.data?.targets ?? []
  const inFlight = IN_FLIGHT.has(handoffState ?? '')
  const stale = inFlight && isStale(session)
  const failed = handoffState === 'failed'
  // Handoff rewrites the row's source to the platform (record_gateway_session_peer).
  const onChannel = ['telegram', 'discord', 'slack'].includes(
    session.source ?? '',
  )

  const label = stale
    ? 'Waiting for gateway…'
    : inFlight
      ? 'Handing off…'
      : failed
        ? 'Handoff failed'
        : onChannel
          ? `${titleCase(session.source!)} · ${
              session.title ??
              (session.thread_id ? `topic ${session.thread_id}` : 'chat')
            }`
          : 'Web'
  const Icon = stale
    ? AlertTriangle
    : inFlight
      ? Loader2
      : failed
        ? AlertTriangle
        : Send
  const needle = filter.trim().toLowerCase()

  return (
    <span
      className="hidden shrink-0 items-center gap-1.5 sm:inline-flex"
      data-testid="meta-channel"
    >
      <span
        aria-hidden="true"
        className="text-[var(--m-border,rgba(255,255,255,0.15))] select-none"
      >
        ·
      </span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setConfirming(null)
            setFilter('')
          }
        }}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={`Session channel: ${label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={
              failed
                ? (session.handoff_error ?? 'Handoff failed')
                : stale
                  ? 'No response from the gateway for 10 minutes — is it running?'
                  : 'Continue this session in a messaging channel'
            }
            className={cn(
              'inline-flex max-w-32 items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
              failed && 'text-red-500',
            )}
            data-testid="channel-selector"
            data-handoff-state={handoffState ?? undefined}
          >
            <Icon
              className={cn(
                'size-3 shrink-0',
                inFlight && !stale && 'animate-spin',
              )}
            />
            <span className="truncate">{label}</span>
            <ChevronDown className="size-2.5 opacity-60" />
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-80 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Channel
          </div>
          {confirming ? (
            <div className="space-y-2 px-2 py-1.5 text-xs">
              <p>
                {confirming.target
                  ? `Continue this session in '${confirming.target.label}'. Any session currently in that topic will be ended.`
                  : `One-way: session moves to a new ${confirming.platform.name} topic. Web view keeps history.`}
              </p>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className="rounded-sm px-2 py-1 hover:bg-accent"
                  onClick={() => setConfirming(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="channel-confirm"
                  autoFocus
                  disabled={handoff.isPending}
                  className="rounded-sm border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-1 font-medium disabled:opacity-50"
                  onClick={() => handoff.mutate(confirming)}
                >
                  {handoff.isPending ? 'Requesting…' : 'Continue'}
                </button>
              </div>
            </div>
          ) : platforms.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">
              No channels configured for{' '}
              {query.data?.profile ?? profile ?? 'this profile'}
            </div>
          ) : (
            platforms.map((p) => {
              const disabled = Boolean(p.unavailableReason) || inFlight
              const own = targets.filter((t) => t.platform === p.id)
              const shown = needle
                ? own.filter(
                    (t) =>
                      t.label.toLowerCase().includes(needle) ||
                      t.threadId.includes(needle),
                  )
                : own
              return (
                <div key={p.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    data-testid={`channel-option-${p.id}`}
                    onClick={() => setConfirming({ platform: p, target: null })}
                    className="flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-medium">
                      {p.unavailableReason ? p.name : `New ${p.name} topic`}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {p.homeChannel
                        ? formatHomeChannelLabel(p.homeChannel)
                        : p.name}
                      {' · '}
                      {inFlight
                        ? 'handoff in progress'
                        : (p.unavailableReason ?? p.state)}
                    </span>
                  </button>
                  {!p.unavailableReason && own.length > 0 && (
                    <div className="mt-1 border-t border-[var(--theme-border)] pt-1">
                      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Existing topics
                      </div>
                      {own.length > 8 && (
                        <input
                          type="search"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                          placeholder="Filter topics"
                          aria-label="Filter existing topics"
                          className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-sm border border-[var(--theme-border)] bg-transparent px-2 py-1 text-xs outline-none"
                        />
                      )}
                      <div className="max-h-56 overflow-y-auto">
                        {shown.map((t) => (
                          <button
                            key={t.target}
                            type="button"
                            disabled={inFlight}
                            data-testid={`channel-target-${t.target}`}
                            onClick={() =>
                              setConfirming({ platform: p, target: t })
                            }
                            className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="truncate font-medium">
                              {t.label}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              topic {t.threadId}
                              {t.lastActive
                                ? ` · ${formatRelative(t.lastActive)}`
                                : ''}
                            </span>
                          </button>
                        ))}
                        {shown.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            No matching topics
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </PopoverContent>
      </Popover>
    </span>
  )
}
