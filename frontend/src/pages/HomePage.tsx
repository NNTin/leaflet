import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { FaGithub } from 'react-icons/fa'
import api from '../api'
import { useSession } from '../session'
import { RateLimitError, parseRetryAfter, useCountdown, formatMMSS } from '../rateLimit'
import styles from './HomePage.module.css'

interface TtlOption {
  label: string;
  value: string;
}

interface ShortenCapabilities {
  ttlOptions: TtlOption[];
  aliasingAllowed: boolean;
  shortenAllowed: boolean;
}

interface ShortenResponse {
  shortCode: string;
  shortUrl: string;
  expiresAt: string | null;
}

export default function HomePage() {
  const navigate = useNavigate()
  const { user, loading: sessionLoading } = useSession()
  const [url, setUrl] = useState('')
  const [ttl, setTtl] = useState('24h')
  const [alias, setAlias] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rateLimitDeadline, setRateLimitDeadline] = useState<number | null>(null)
  const [capabilities, setCapabilities] = useState<ShortenCapabilities | null>(null)

  const countdown = useCountdown(rateLimitDeadline)
  const isRateLimited = rateLimitDeadline !== null && !countdown.isExpired

  useEffect(() => {
    if (sessionLoading) return

    api.get<ShortenCapabilities>('/shorten/capabilities')
      .then(res => {
        setCapabilities(res.data)
        setTtl(prev => {
          const options = res.data.ttlOptions
          if (options.find(o => o.value === prev)) return prev
          return options[0]?.value ?? '24h'
        })
      })
      .catch(() => {
        // keep capabilities null; form remains functional with no TTL options shown
      })
  }, [sessionLoading, user?.role])

  const ttlOptions = capabilities?.ttlOptions ?? []
  const canAlias = capabilities?.aliasingAllowed ?? false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Guard: still in rate-limit window
    if (isRateLimited) return

    setError('')
    setRateLimitDeadline(null)

    if (!url.trim()) {
      setError('Please enter a URL.')
      return
    }

    try {
      new URL(url.trim())
    } catch {
      setError('Please enter a valid URL (include https://).')
      return
    }

    setLoading(true)
    try {
      const payload: { url: string; ttl: string; alias?: string } = { url: url.trim(), ttl }
      if (canAlias && alias.trim()) {
        payload.alias = alias.trim()
      }

      const res = await api.post<ShortenResponse>('/shorten', payload)
      const { shortCode, shortUrl, expiresAt } = res.data
      navigate('/result', { state: { shortCode, shortUrl, expiresAt } })
    } catch (err) {
      if (err instanceof RateLimitError) {
        // CSRF bootstrap was rate-limited
        setRateLimitDeadline(parseRetryAfter(err.retryAfter))
      } else if (axios.isAxiosError(err)) {
        if (err.response?.status === 429) {
          // Shorten endpoint was rate-limited
          const retryAfter = (err.response.headers as Record<string, string | undefined>)['retry-after'] ?? null
          setRateLimitDeadline(parseRetryAfter(retryAfter))
        } else {
          const msg = err.response?.data?.error ?? err.response?.data?.message ?? 'Failed to shorten URL. Please try again.'
          setError(msg)
        }
      } else {
        setError('Failed to shorten URL. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <div className={styles.heroIcon}>🌱💌</div>
        <h1 className={styles.heroTitle}>Leaflet</h1>
        <p className={styles.heroTagline}>
          Privacy-first URL shortener. No tracking, no ads.
        </p>
      </div>

      <div className={`card ${styles.formCard}`}>
        <form onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="url-input">
              Paste your long URL
            </label>
            <input
              id="url-input"
              type="url"
              className={styles.input}
              placeholder="https://example.com/very/long/url..."
              value={url}
              onChange={e => setUrl(e.target.value)}
              autoFocus
              required
            />
          </div>

          {ttlOptions.length > 0 && (
            <div className={styles.ttlRow}>
              <span className={styles.ttlLabel}>Link expires after:</span>
              <div className={styles.ttlOptions}>
                {ttlOptions.map(opt => (
                  <label key={opt.value} className={styles.ttlOption}>
                    <input
                      type="radio"
                      name="ttl"
                      value={opt.value}
                      checked={ttl === opt.value}
                      onChange={() => setTtl(opt.value)}
                    />
                    <span className={styles.ttlText}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {canAlias && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="alias-input">
                Custom alias <span className={styles.optional}>(optional)</span>
              </label>
              <div className={styles.aliasWrapper}>
                <span className={styles.aliasPrefix}>/s/</span>
                <input
                  id="alias-input"
                  type="text"
                  className={styles.aliasInput}
                  placeholder="my-custom-link"
                  value={alias}
                  onChange={e => setAlias(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                  maxLength={50}
                />
              </div>
            </div>
          )}

          {error && <div className="error-msg">{error}</div>}

          {isRateLimited && (
            <div className={styles.rateLimitMsg} aria-live="polite">
              Too many requests. Try again in {formatMMSS(countdown.msLeft)}.
            </div>
          )}

          <button
            type="submit"
            className={`btn btn-primary ${styles.submitBtn}`}
            disabled={loading || isRateLimited}
            aria-disabled={loading || isRateLimited}
          >
            {loading
              ? 'Shortening…'
              : isRateLimited
              ? `⏱ ${formatMMSS(countdown.msLeft)}`
              : '✂️ Shorten URL'}
          </button>
        </form>
      </div>

      <div className={styles.features}>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>🔒</span>
          <span>No personal data collected</span>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>⏱️</span>
          <span>Auto-expiring links</span>
        </div>
        <a
          className={`${styles.feature} ${styles.featureLink}`}
          href="https://github.com/NNTin/leaflet"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className={styles.featureIcon} aria-hidden="true">
            <FaGithub />
          </span>
          <span>Open source</span>
        </a>
      </div>
    </main>
  )
}
