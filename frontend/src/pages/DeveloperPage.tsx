import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import LoadingSpinner from '../components/LoadingSpinner'
import { apiUrl } from '../urls'
import { parseRetryAfter, useCountdown, formatMMSS } from '../rateLimit'
import styles from './DeveloperPage.module.css'

export default function DeveloperPage() {
  const apiBase = new URL(apiUrl(''), window.location.origin).toString().replace(/\/$/, '')

  const [spec, setSpec] = useState<unknown>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [rateLimitDeadline, setRateLimitDeadline] = useState<number | null>(null)

  const countdown = useCountdown(rateLimitDeadline)

  const fetchSpec = useCallback(() => {
    setFetchError(null)
    setRateLimitDeadline(null)
    axios
      .get(apiUrl('/openapi.json'), { withCredentials: true })
      .then((res) => setSpec(res.data))
      .catch((err: unknown) => {
        if (axios.isAxiosError(err) && err.response?.status === 429) {
          const retryAfter = (err.response.headers as Record<string, string | undefined>)['retry-after'] ?? null
          setRateLimitDeadline(parseRetryAfter(retryAfter))
        } else {
          setFetchError('Failed to load API documentation.')
        }
      })
  }, [])

  useEffect(() => {
    fetchSpec()
  }, [fetchSpec])

  // Auto-retry when rate-limited.
  useEffect(() => {
    if (!rateLimitDeadline) return
    const msLeft = Math.max(0, rateLimitDeadline - Date.now())
    const id = setTimeout(() => fetchSpec(), msLeft + 100)
    return () => clearTimeout(id)
  }, [rateLimitDeadline, fetchSpec])

  return (
    <div className={`page-container-wide ${styles.content}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Developer API</h1>
        <p className={styles.description}>
          Leaflet exposes a simple REST API for creating and managing short
          links programmatically. All endpoints are under{' '}
          <code className={styles.code}>{apiBase}</code>.
        </p>
        <div className={styles.infoRow}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Base URL</span>
            <code className={styles.infoValue}>{apiBase}</code>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Authentication</span>
            <span className={styles.infoValue}>Session cookie (GitHub OAuth)</span>
          </div>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>CSRF Protection</span>
            <span className={styles.infoValue}>X-CSRF-Token header required for writes</span>
          </div>
        </div>
      </header>

      <div className={`card ${styles.swaggerCard}`}>
        {spec ? (
          <SwaggerUI
            spec={spec}
            docExpansion="list"
            defaultModelsExpandDepth={-1}
          />
        ) : rateLimitDeadline && !countdown.isExpired ? (
          <div className={styles.specState} aria-live="polite">
            <p className={styles.specStateMsg}>
              API documentation rate limited.
            </p>
            <p className={styles.specStateCountdown}>
              Auto-retrying in {formatMMSS(countdown.msLeft)}…
            </p>
          </div>
        ) : fetchError ? (
          <div className={styles.specState}>
            <p className={styles.specStateMsg}>{fetchError}</p>
            <button className="btn btn-secondary btn-sm" onClick={fetchSpec}>
              Retry
            </button>
          </div>
        ) : (
          <div className={styles.specState}>
            <LoadingSpinner />
            <p className={styles.specStateMsg}>Loading API documentation…</p>
          </div>
        )}
      </div>
    </div>
  )
}
