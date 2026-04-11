import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Navbar from '../components/Navbar'
import api from '../api'
import { authUrl } from '../urls'
import { meCache } from '../authCache'
import styles from './HomePage.module.css'

interface TtlOption {
  label: string;
  value: string;
}

const TTL_OPTIONS: TtlOption[] = [
  { label: '5 minutes', value: '5m' },
  { label: '1 hour', value: '1h' },
  { label: '24 hours', value: '24h' },
]

const ADMIN_TTL: TtlOption = { label: 'Never expire', value: 'never' }

interface User {
  id: number;
  username: string;
  role: string;
}

interface ShortenResponse {
  shortCode: string;
  shortUrl: string;
  expiresAt: string | null;
}

export default function HomePage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [ttl, setTtl] = useState('24h')
  const [alias, setAlias] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const cached = meCache.get()
    if (cached !== null) {
      setUser(cached)
      return
    }
    axios.get<User | null>(authUrl('/me'), { withCredentials: true })
      .then(res => {
        meCache.set(res.data)
        setUser(res.data)
      })
      .catch(() => setUser(null))
  }, [])

  const ttlOptions = user?.role === 'admin'
    ? [...TTL_OPTIONS, ADMIN_TTL]
    : TTL_OPTIONS

  const canAlias = user?.role === 'admin' || user?.role === 'privileged'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

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
      if (axios.isAxiosError(err)) {
        const msg = err.response?.data?.error ?? err.response?.data?.message ?? 'Failed to shorten URL. Please try again.'
        setError(msg)
      } else {
        setError('Failed to shorten URL. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <Navbar user={user} />

      <main className={styles.main}>
        <div className={styles.hero}>
          <div className={styles.heroIcon}>🌱📍</div>
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

            <button
              type="submit"
              className={`btn btn-primary ${styles.submitBtn}`}
              disabled={loading}
            >
              {loading ? 'Shortening…' : '✂️ Shorten URL'}
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
          <div className={styles.feature}>
            <span className={styles.featureIcon}>📦</span>
            <span>Open source</span>
          </div>
        </div>
      </main>
    </div>
  )
}
