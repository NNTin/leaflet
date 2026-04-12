import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { csrfHeaders } from './api'
import { MISS, fetchMe, meCache, providersCache, type AuthUser } from './authCache'
import { authUrl } from './urls'

interface SessionContextValue {
  user: AuthUser | null;
  loading: boolean;
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

  useEffect(() => {
    if (initialCached !== MISS) return

    let cancelled = false

    void fetchMe()
      .then((nextUser) => {
        if (!cancelled) setUser(nextUser)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [initialCached])

  async function refreshSession() {
    meCache.clear()
    setLoading(true)

    try {
      const nextUser = await fetchMe()
      setUser(nextUser)
      return nextUser
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }

  function clearSession() {
    meCache.clear()
    providersCache.clear()
    setUser(null)
    setLoading(false)
  }

  async function logout() {
    try {
      const headers = await csrfHeaders()
      await fetch(authUrl('/logout'), { method: 'POST', credentials: 'include', headers })
    } catch {
    } finally {
      clearSession()
    }
  }

  return (
    <SessionContext.Provider value={{ user, loading, refreshSession, clearSession, logout }}>
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
