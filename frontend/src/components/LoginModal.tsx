import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import { authUrl } from '../urls'
import { PROVIDER_META_MAP } from '../providers'
import { parseRetryAfter, useCountdown, formatMMSS, type RateLimitState } from '../rateLimit'
import styles from './LoginModal.module.css'

interface AvailableProvider {
  name: string;
  label: string;
}

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [providers, setProviders] = useState<AvailableProvider[] | null>(null)
  const [error, setError] = useState(false)
  const [rateLimited, setRateLimited] = useState<RateLimitState | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

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
        } else {
          setError(true)
        }
      })
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  // Auto-retry when rate-limited.
  const countdown = useCountdown(rateLimited?.retryDeadline ?? null)
  useEffect(() => {
    if (!rateLimited?.isAutoRetry) return
    const msLeft = Math.max(0, rateLimited.retryDeadline - Date.now())
    const id = setTimeout(() => fetchProviders(), msLeft + 100)
    return () => clearTimeout(id)
  }, [rateLimited, fetchProviders])

  // Close on Escape key.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Set initial focus on the dialog when it opens.
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      className={styles.backdrop}
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id="login-modal-title" className={styles.title}>Sign in to Leaflet</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className={styles.subtitle}>
          Choose a provider to continue
        </p>

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

          {!error && !rateLimited && providers !== null && providers.length > 0 && (
            <ul className={styles.providerList} role="list">
              {providers.map(({ name, label }) => {
                const meta = PROVIDER_META_MAP[name]
                const IconComponent = meta?.icon
                return (
                  <li key={name}>
                    <a
                      href={authUrl(`/${name}`, window.location.href)}
                      className={styles.providerBtn}
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
      </div>
    </div>
  )
}
