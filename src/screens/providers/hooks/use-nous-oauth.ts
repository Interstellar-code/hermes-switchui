/**
 * use-nous-oauth.ts — device-code sign-in for Nous Portal.
 *
 * Lifted from claude-onboarding.tsx, which held the only working copy. Only
 * `nous` is supported: /api/oauth/device-code and /api/oauth/poll-token both
 * hard-reject every other provider id, so the wizard tells the truth about
 * that rather than pretending OAuth works everywhere the catalog advertises it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export type OAuthStage = 'idle' | 'starting' | 'waiting' | 'success' | 'error'

export const OAUTH_SUPPORTED_PROVIDERS = ['nous'] as const

export function isOAuthSupported(providerId: string): boolean {
  return (OAUTH_SUPPORTED_PROVIDERS as ReadonlyArray<string>).includes(
    providerId,
  )
}

type DeviceCodeResponse = {
  device_code?: string
  user_code?: string
  verification_uri_complete?: string
  interval?: number
  error?: string
}

export function useNousOAuth() {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<OAuthStage>('idle')
  const [userCode, setUserCode] = useState('')
  const [verificationUrl, setVerificationUrl] = useState('')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const reset = useCallback(() => {
    stopPolling()
    setStage('idle')
    setUserCode('')
    setVerificationUrl('')
    setError('')
  }, [stopPolling])

  const start = useCallback(
    async (providerId: string) => {
      if (!isOAuthSupported(providerId)) {
        setError(`OAuth is not wired up for ${providerId} yet.`)
        setStage('error')
        return
      }

      setStage('starting')
      setError('')
      try {
        const res = await fetch('/api/oauth/device-code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: providerId }),
        })
        const data = (await res.json()) as DeviceCodeResponse
        if (!res.ok || data.error || !data.device_code) {
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }

        setUserCode(data.user_code ?? '')
        setVerificationUrl(data.verification_uri_complete ?? '')
        setStage('waiting')

        const intervalMs = Math.max((data.interval ?? 5) * 1000, 3000)
        stopPolling()
        pollRef.current = setInterval(() => {
          void (async () => {
            try {
              const pollRes = await fetch('/api/oauth/poll-token', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  provider: providerId,
                  deviceCode: data.device_code,
                }),
              })
              const pollData = (await pollRes.json()) as {
                status?: string
                error?: string
              }
              if (pollData.status === 'success') {
                stopPolling()
                setStage('success')
                await queryClient.invalidateQueries({ queryKey: ['providers'] })
              } else if (pollData.status === 'error') {
                stopPolling()
                setError(pollData.error ?? 'Authorization failed')
                setStage('error')
              }
            } catch {
              // Keep polling — the user may still be approving in the browser.
            }
          })()
        }, intervalMs)
      } catch (startError) {
        setError(
          startError instanceof Error
            ? startError.message
            : 'Could not start OAuth',
        )
        setStage('error')
      }
    },
    [queryClient, stopPolling],
  )

  return { stage, userCode, verificationUrl, error, start, reset }
}
