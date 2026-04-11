import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import Navbar from '../components/Navbar'
import { authUrl } from '../urls'
import { csrfHeaders } from '../api'
import { PROVIDER_META } from '../providers'
import styles from './SettingsPage.module.css'

interface User {
  id: number;
  username: string;
  role: string;
}

interface Identity {
  id: number;
  provider: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  connectedAt: string;
}

export default function SettingsPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loadingIdentities, setLoadingIdentities] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)

  // Fetch current user.
  useEffect(() => {
    axios
      .get<User | null>(authUrl('/me'), { withCredentials: true })
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
  }, [])

  // Fetch connected identities once user is known.
  const fetchIdentities = useCallback(() => {
    if (!user) return
    setLoadingIdentities(true)
    axios
      .get<Identity[]>(authUrl('/identities'), { withCredentials: true })
      .then((res) => setIdentities(res.data))
      .catch(() => setError('Failed to load connected accounts.'))
      .finally(() => setLoadingIdentities(false))
  }, [user])

  useEffect(() => {
    fetchIdentities()
  }, [fetchIdentities])

  // Disconnect a provider.
  async function handleDisconnect(provider: string) {
    if (actionPending) return
    setError(null)
    setActionPending(provider)
    try {
      const headers = await csrfHeaders()
      await axios.delete(authUrl(`/identities/${provider}`), {
        withCredentials: true,
        headers,
      })
      fetchIdentities()
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string })?.error
        setError(msg ?? 'Failed to disconnect account.')
      } else {
        setError('Unexpected error.')
      }
    } finally {
      setActionPending(null)
    }
  }

  // Navigate to provider connect flow.
  function handleConnect(provider: string) {
    window.location.href = authUrl(`/${provider}/link`, window.location.href)
  }

  const connectedProviders = new Set(identities.map((i) => i.provider))

  if (user === undefined) {
    return (
      <div className={styles.page}>
        <Navbar user={null} />
        <main className={styles.main}>
          <div className={styles.loading}>Loading…</div>
        </main>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={styles.page}>
        <Navbar user={null} />
        <main className={styles.main}>
          <div className={styles.loginPrompt}>
            <p>Please log in to manage your settings.</p>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {PROVIDER_META.map(({ name, label, icon }) => (
                <a
                  key={name}
                  href={authUrl(`/${name}`, window.location.href)}
                  className="btn"
                  style={{ background: 'var(--green-primary)', color: '#fff' }}
                >
                  {icon} {label}
                </a>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <Navbar user={user} />
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.heading}>Settings</h1>
          <p className={styles.subheading}>Manage your account and connected login methods.</p>

          {error && <div className={styles.error}>{error}</div>}

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>🔗</span>
              <span className={styles.sectionTitle}>Connected Accounts</span>
            </div>

            {identities.length > 1 && (
              <p className={styles.infoBox}>
                You have {identities.length} connected login methods. You must keep at least one.
              </p>
            )}

            {loadingIdentities ? (
              <div className={styles.loading}>Loading…</div>
            ) : (
              PROVIDER_META.map(({ name, label, icon }) => {
                const identity = identities.find((i) => i.provider === name)
                const isConnected = connectedProviders.has(name)
                const isLastIdentity = identities.length <= 1

                return (
                  <div key={name} className={styles.providerRow}>
                    <div className={styles.providerInfo}>
                      <span className={styles.providerIcon}>{icon}</span>
                      <div>
                        <div className={styles.providerName}>{label}</div>
                        {isConnected && identity ? (
                          <div className={styles.providerStatus}>
                            {identity.displayName ?? identity.email ?? 'Connected'}
                          </div>
                        ) : (
                          <div className={styles.providerStatus}>Not connected</div>
                        )}
                      </div>
                    </div>

                    <div className={styles.actions}>
                      {isConnected ? (
                        <>
                          <span className={styles.connectedBadge}>✓ Connected</span>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={isLastIdentity || actionPending !== null}
                            title={isLastIdentity ? 'Cannot disconnect your only login method.' : `Disconnect ${label}`}
                            onClick={() => handleDisconnect(name)}
                          >
                            {actionPending === name ? 'Disconnecting…' : 'Disconnect'}
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleConnect(name)}
                          disabled={actionPending !== null}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
