import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Error type for rate-limit responses
// ---------------------------------------------------------------------------

export class RateLimitError extends Error {
  constructor(
    public readonly retryAfter: string | null,
    message = 'Rate limit exceeded.',
  ) {
    super(message)
    this.name = 'RateLimitError'
  }
}

// ---------------------------------------------------------------------------
// State shape for active rate-limit display
// ---------------------------------------------------------------------------

export interface RateLimitState {
  message: string;
  retryDeadline: number;
  isAutoRetry: boolean;
}

// ---------------------------------------------------------------------------
// Parse Retry-After header (delta-seconds or HTTP-date)
// ---------------------------------------------------------------------------

const FALLBACK_DELAY_MS = 60_000

export function parseRetryAfter(header: string | null | undefined): number {
  if (!header) return Date.now() + FALLBACK_DELAY_MS

  // delta-seconds form
  const delta = parseInt(header, 10)
  if (!isNaN(delta) && delta >= 0) {
    return Date.now() + delta * 1000
  }

  // HTTP-date form
  const date = new Date(header)
  if (!isNaN(date.getTime())) {
    return date.getTime()
  }

  return Date.now() + FALLBACK_DELAY_MS
}

// ---------------------------------------------------------------------------
// Format milliseconds remaining as MM:SS
// ---------------------------------------------------------------------------

export function formatMMSS(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Live countdown hook
// ---------------------------------------------------------------------------

export interface CountdownResult {
  secondsLeft: number;
  msLeft: number;
  isExpired: boolean;
}

export function useCountdown(deadline: number | null): CountdownResult {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (deadline === null) return
    // If already past the deadline, no interval needed.
    if (Date.now() >= deadline) return

    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= deadline) {
        clearInterval(id)
      }
    }, 500)

    return () => clearInterval(id)
  }, [deadline])

  if (deadline === null) {
    return { secondsLeft: 0, msLeft: 0, isExpired: false }
  }

  const msLeft = Math.max(0, deadline - now)
  const secondsLeft = Math.ceil(msLeft / 1000)
  return { secondsLeft, msLeft, isExpired: msLeft === 0 }
}
