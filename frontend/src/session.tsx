import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { csrfHeaders } from './api'
import { MISS, fetchMe, meCache, providersCache, type AuthUser } from './authCache'
import { RateLimitError, parseRetryAfter, type RateLimitState } from './rateLimit'
import { authUrl } from './urls'

interface SessionContextValue {
  user: AuthUser | null;
  loading: boolean;
  meRateLimited: RateLimitState | null;
  logoutRateLimited: RateLimitState | null;
  refreshSession: () => Promise<AuthUser | null>;
  clearSession: () => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialCachedRef = useRef<AuthUser | null | typeof MISS>(meCache.get())
  const initialCached = initialCachedRef.current
  const [user, setUser] = useState<AuthUser | null>(initialCached === MISS ? null : initialCached)
  const [loading, setLoading] = useState(initialCached === MISS)
  const [meRateLimited, setMeRateLimited] = useState<RateLimitState | null>(null)
  const [logoutRateLimited, setLogoutRateLimited] = useState<RateLimitState | null>(null)

  // Core refresh logic (stable, no reactive deps captured).
  const doRefreshSession = useCallback(async (): Promise<AuthUser | null> => {
    meCache.clear()
    setLoading(true)
    setMeRateLimited(null)

    try {
      const nextUser = await fetchMe()
      setUser(nextUser)
      return nextUser
    } catch (err) {
      if (err instanceof RateLimitError) {
        const retryDeadline = parseRetryAfter(err.retryAfter)
        setMeRateLimited({
          message: 'Authentication check rate limited. Will retry automatically.',
          retryDeadline,
          isAutoRetry: true,
        })
        // Preserve the current user state; do not collapse to logged-out.
        return null
      }
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load when cache is empty.
  useEffect(() => {
    if (initialCached !== MISS) return

    let cancelled = false

    void fetchMe()
      .then((nextUser) => {
        if (!cancelled) {
          setUser(nextUser)
          setMeRateLimited(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (err instanceof RateLimitError) {
            const retryDeadline = parseRetryAfter(err.retryAfter)
            setMeRateLimited({
              message: 'Authentication check rate limited. Will retry automatically.',
              retryDeadline,
              isAutoRetry: true,
            })
          } else {
            setUser(null)
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [initialCached])

  // Auto-retry when /auth/me is rate-limited.
  useEffect(() => {
    if (!meRateLimited?.isAutoRetry) return
    const msLeft = Math.max(0, meRateLimited.retryDeadline - Date.now())
    const id = setTimeout(() => {
      void doRefreshSession()
    }, msLeft + 100)
    return () => clearTimeout(id)
  }, [meRateLimited, doRefreshSession])

  async function refreshSession() {
    return doRefreshSession()
  }

  function clearSession() {
    meCache.clear()
    providersCache.clear()
    setUser(null)
    setMeRateLimited(null)
    setLogoutRateLimited(null)
    setLoading(false)
  }

  async function logout() {
    setLogoutRateLimited(null)
    try {
      const headers = await csrfHeaders()
      const res = await fetch(authUrl('/logout'), { method: 'POST', credentials: 'include', headers })
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after')
        setLogoutRateLimited({
          message: 'Logout rate limited. Please try again shortly.',
          retryDeadline: parseRetryAfter(retryAfter),
          isAutoRetry: false,
        })
        return // do NOT clear local session – server session is still active
      }
      clearSession()
    } catch (err) {
      if (err instanceof RateLimitError) {
        setLogoutRateLimited({
          message: 'Logout rate limited. Please try again shortly.',
          retryDeadline: parseRetryAfter(err.retryAfter),
          isAutoRetry: false,
        })
        return // do NOT clear local session – server session is still active
      }
      // Other errors: best-effort – still clear local session.
      clearSession()
    }
  }

  return (
    <SessionContext.Provider value={{ user, loading, meRateLimited, logoutRateLimited, refreshSession, clearSession, logout }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const context = useContext(SessionContext)

  if (!context) {
    throw new Error('useSession must be used within a SessionProvider.')
  }

  return context
}
