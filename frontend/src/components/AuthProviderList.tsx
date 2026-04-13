import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { authUrl } from '../urls'
import { PROVIDER_META_MAP } from '../providers'
import { parseRetryAfter, useCountdown, formatMMSS, type RateLimitState } from '../rateLimit'
import styles from './AuthProviderList.module.css'

interface AvailableProvider {
  name: string;
  label: string;
}

interface AuthProviderListProps {
  returnTo?: string;
}

export default function AuthProviderList({ returnTo }: AuthProviderListProps) {
  const [providers, setProviders] = useState<AvailableProvider[] | null>(null)
  const [error, setError] = useState(false)
  const [rateLimited, setRateLimited] = useState<RateLimitState | null>(null)
  const [flowRateLimited, setFlowRateLimited] = useState<RateLimitState | null>(null)

  const fetchProviders = useCallback(() => {
    setError(false)
    setRateLimited(null)
    axios
      .get<AvailableProvider[]>(authUrl('/providers'), { withCredentials: true })
      .then((res) => setProviders(res.data))
      .catch((err: unknown) => {
        if (axios.isAxiosError(err) && err.response?.status === 429) {
          const retryAfter = (err.response.headers as Record<string, string | undefined>)['retry-after'] ?? null
          setRateLimited({
            message: 'Sign-in options rate limited.',
            retryDeadline: parseRetryAfter(retryAfter),
            isAutoRetry: true,
          })
          return
        }

        setError(true)
      })
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const countdown = useCountdown(rateLimited?.retryDeadline ?? null)
  useEffect(() => {
    if (!rateLimited?.isAutoRetry) return
    const msLeft = Math.max(0, rateLimited.retryDeadline - Date.now())
    const id = setTimeout(() => fetchProviders(), msLeft + 100)
    return () => clearTimeout(id)
  }, [rateLimited, fetchProviders])

  const flowCountdown = useCountdown(flowRateLimited?.retryDeadline ?? null)

  function isSameOriginAuthUrl(url: string): boolean {
    try {
      return new URL(url, window.location.href).origin === window.location.origin
    } catch {
      return false
    }
  }

  async function handleProviderClick(e: React.MouseEvent, name: string) {
    e.preventDefault()
    setFlowRateLimited(null)

    const url = authUrl(`/${name}`, returnTo)

    if (!isSameOriginAuthUrl(url)) {
      window.location.href = url
      return
    }

    try {
      const res = await fetch(url, { redirect: 'manual', credentials: 'include' })
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after')
        setFlowRateLimited({
          message: 'Sign-in rate limited. Please wait before trying again.',
          retryDeadline: parseRetryAfter(retryAfter),
          isAutoRetry: false,
        })
        return
      }

      window.location.href = url
    } catch {
      window.location.href = url
    }
  }

  return (
    <div className={styles.body}>
      {error && (
        <div className={styles.errorState}>
          <p>Could not load sign-in options.</p>
          <button className="btn btn-secondary btn-sm" onClick={fetchProviders}>
            Retry
          </button>
        </div>
      )}

      {!error && rateLimited && (
        <div className={styles.rateLimitState} aria-live="polite">
          <p>Sign-in options temporarily unavailable.</p>
          <p className={styles.rateLimitCountdown}>
            {countdown.isExpired ? 'Retrying…' : `Retrying in ${formatMMSS(countdown.msLeft)}`}
          </p>
        </div>
      )}

      {!error && !rateLimited && providers === null && (
        <div className={styles.loadingState} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Loading…</span>
        </div>
      )}

      {!error && !rateLimited && providers !== null && providers.length === 0 && (
        <p className={styles.emptyState}>
          No sign-in providers are currently configured. Please contact the server administrator.
        </p>
      )}

      {flowRateLimited && !flowCountdown.isExpired && (
        <div className={styles.rateLimitState} aria-live="polite">
          <p>{flowRateLimited.message}</p>
          <p className={styles.rateLimitCountdown}>
            {`Retry in ${formatMMSS(flowCountdown.msLeft)}`}
          </p>
        </div>
      )}

      {!error && !rateLimited && providers !== null && providers.length > 0 && (
        <ul className={styles.providerList} role="list">
          {providers.map(({ name, label }) => {
            const meta = PROVIDER_META_MAP[name]
            const IconComponent = meta?.icon
            const providerHref = authUrl(`/${name}`, returnTo)

            return (
              <li key={name}>
                <a
                  href={providerHref}
                  className={styles.providerBtn}
                  onClick={(e) => void handleProviderClick(e, name)}
                >
                  <span className={styles.providerIcon} aria-hidden="true">
                    {IconComponent ? <IconComponent size={18} aria-hidden={true} /> : '🔑'}
                  </span>
                  <span>Continue with {label}</span>
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
