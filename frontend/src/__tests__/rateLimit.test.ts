import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { parseRetryAfter, formatMMSS, useCountdown, RateLimitError } from '../rateLimit'

describe('parseRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns deadline = now + delta for delta-seconds form', () => {
    const now = Date.now()
    const deadline = parseRetryAfter('30')
    expect(deadline).toBe(now + 30_000)
  })

  it('handles zero seconds', () => {
    const now = Date.now()
    const deadline = parseRetryAfter('0')
    expect(deadline).toBe(now)
  })

  it('parses HTTP-date form', () => {
    const future = new Date('2024-01-01T12:01:00Z')
    const deadline = parseRetryAfter(future.toUTCString())
    expect(deadline).toBe(future.getTime())
  })

  it('falls back to 60s for null', () => {
    const now = Date.now()
    const deadline = parseRetryAfter(null)
    expect(deadline).toBe(now + 60_000)
  })

  it('falls back to 60s for undefined', () => {
    const now = Date.now()
    const deadline = parseRetryAfter(undefined)
    expect(deadline).toBe(now + 60_000)
  })

  it('falls back to 60s for empty string', () => {
    const now = Date.now()
    const deadline = parseRetryAfter('')
    expect(deadline).toBe(now + 60_000)
  })

  it('falls back to 60s for invalid string', () => {
    const now = Date.now()
    const deadline = parseRetryAfter('not-a-date')
    expect(deadline).toBe(now + 60_000)
  })
})

describe('formatMMSS', () => {
  it('formats zero ms as 00:00', () => {
    expect(formatMMSS(0)).toBe('00:00')
  })

  it('formats negative ms as 00:00', () => {
    expect(formatMMSS(-100)).toBe('00:00')
  })

  it('formats 30s as 00:30', () => {
    expect(formatMMSS(30_000)).toBe('00:30')
  })

  it('formats 90s as 01:30', () => {
    expect(formatMMSS(90_000)).toBe('01:30')
  })

  it('formats 1h as 60:00', () => {
    expect(formatMMSS(3_600_000)).toBe('60:00')
  })

  it('rounds up partial seconds', () => {
    // 30.5s rounds up to 31s = 00:31
    expect(formatMMSS(30_500)).toBe('00:31')
  })

  it('pads minutes and seconds to 2 digits', () => {
    expect(formatMMSS(5_000)).toBe('00:05')
    expect(formatMMSS(65_000)).toBe('01:05')
  })
})

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns zero values when deadline is null', () => {
    const { result } = renderHook(() => useCountdown(null))
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.msLeft).toBe(0)
    expect(result.current.isExpired).toBe(false)
  })

  it('ticks down over time', async () => {
    const deadline = Date.now() + 5_000

    const { result } = renderHook(() => useCountdown(deadline))

    expect(result.current.secondsLeft).toBe(5)
    expect(result.current.isExpired).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(result.current.secondsLeft).toBe(3)
    expect(result.current.isExpired).toBe(false)
  })

  it('reports isExpired = true when deadline passes', async () => {
    const deadline = Date.now() + 1_000

    const { result } = renderHook(() => useCountdown(deadline))

    expect(result.current.isExpired).toBe(false)

    act(() => {
      vi.advanceTimersByTime(2_000)
    })

    expect(result.current.isExpired).toBe(true)
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.msLeft).toBe(0)
  })

  it('reports isExpired immediately for a past deadline', () => {
    const deadline = Date.now() - 1_000
    const { result } = renderHook(() => useCountdown(deadline))
    expect(result.current.msLeft).toBe(0)
    expect(result.current.isExpired).toBe(true)
  })

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const deadline = Date.now() + 10_000
    const { unmount } = renderHook(() => useCountdown(deadline))
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})

describe('RateLimitError', () => {
  it('has name RateLimitError', () => {
    const err = new RateLimitError('30')
    expect(err.name).toBe('RateLimitError')
    expect(err instanceof Error).toBe(true)
    expect(err instanceof RateLimitError).toBe(true)
  })

  it('stores retryAfter', () => {
    const err = new RateLimitError('60')
    expect(err.retryAfter).toBe('60')
  })

  it('stores null retryAfter', () => {
    const err = new RateLimitError(null)
    expect(err.retryAfter).toBeNull()
  })

  it('uses default message', () => {
    const err = new RateLimitError(null)
    expect(err.message).toBe('Rate limit exceeded.')
  })

  it('accepts custom message', () => {
    const err = new RateLimitError(null, 'Custom msg')
    expect(err.message).toBe('Custom msg')
  })
})
