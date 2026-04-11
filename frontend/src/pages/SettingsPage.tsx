import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import axios from 'axios'
import Navbar from '../components/Navbar'
import { authUrl } from '../urls'
import { csrfHeaders } from '../api'
import { PROVIDER_META, PROVIDER_META_MAP } from '../providers'
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

type IdentitiesResponse = Identity[] | { identities?: Identity[] };

interface LinkConflict {
  provider: string;
  conflictingUserId: number;
}

interface MergeInitiateResponse {
  mergeToken: string;
}

function normalizeIdentities(data: IdentitiesResponse): Identity[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.identities)) {
    return data.identities;
  }

  return [];
}

function readLinkConflict(): LinkConflict | null {
  const params = new URLSearchParams(window.location.search)
  const auth = params.get('auth')
  const provider = params.get('provider')
  const conflictingUserId = params.get('conflictingUserId')

  if (auth !== 'link_conflict' || !provider || !conflictingUserId || !/^\d+$/.test(conflictingUserId)) {
    return null
  }

  return {
    provider,
    conflictingUserId: Number(conflictingUserId),
  }
}

function clearLinkConflictSearchParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  url.searchParams.delete('provider')
  url.searchParams.delete('conflictingUserId')
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

export default function SettingsPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loadingIdentities, setLoadingIdentities] = useState(false)
  const [availableProviders, setAvailableProviders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [linkConflict, setLinkConflict] = useState<LinkConflict | null>(() => readLinkConflict())

  // Fetch current user.
  useEffect(() => {
    axios
      .get<User | null>(authUrl('/me'), { withCredentials: true })
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
  }, [])

  // Fetch which providers are configured on this server (only when authenticated).
  useEffect(() => {
    if (!user) return
    axios
      .get<{ name: string }[]>(authUrl('/providers'), { withCredentials: true })
      .then((res) => setAvailableProviders(res.data.map((p) => p.name)))
      .catch(() => {
        // Fall back to showing all known providers so the page isn't empty.
        setAvailableProviders(PROVIDER_META.map((p) => p.name))
      })
  }, [user])

  // Fetch connected identities once user is known.
  const fetchIdentities = useCallback(async () => {
    if (!user) return
    setLoadingIdentities(true)
    try {
      const res = await axios.get<IdentitiesResponse>(authUrl('/identities'), { withCredentials: true })
      setIdentities(normalizeIdentities(res.data))
    } catch {
      setError('Failed to load connected accounts.')
    } finally {
      setLoadingIdentities(false)
    }
  }, [user])

  useEffect(() => {
    void fetchIdentities()
  }, [fetchIdentities])

  useEffect(() => {
    if (!linkConflict) return

    const isProviderConnected = identities.some((identity) => identity.provider === linkConflict.provider)
    if (!isProviderConnected) return

    clearLinkConflictSearchParams()
    setLinkConflict(null)
    setSuccess((current) => {
      if (current) return current
      const label = PROVIDER_META_MAP[linkConflict.provider]?.label ?? linkConflict.provider
      return `${label} is already connected to this account.`
    })
  }, [identities, linkConflict])

  // Disconnect a provider.
  async function handleDisconnect(provider: string) {
    if (actionPending) return
    setError(null)
    setSuccess(null)
    setActionPending(provider)
    try {
      const headers = await csrfHeaders()
      await axios.delete(authUrl(`/identities/${provider}`), {
        withCredentials: true,
        headers,
      })
      await fetchIdentities()
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

  async function handleMergeConflict() {
    if (!linkConflict || actionPending) return

    setError(null)
    setSuccess(null)
    setActionPending('merge')

    try {
      if (identities.some((identity) => identity.provider === linkConflict.provider)) {
        clearLinkConflictSearchParams()
        setLinkConflict(null)

        const label = PROVIDER_META_MAP[linkConflict.provider]?.label ?? linkConflict.provider
        setSuccess(`${label} is already connected to this account.`)
        return
      }

      const headers = await csrfHeaders()
      const initiateRes = await axios.post<MergeInitiateResponse>(
        authUrl('/merge/initiate'),
        { targetUserId: linkConflict.conflictingUserId },
        {
          withCredentials: true,
          headers,
        },
      )

      await axios.post(
        authUrl('/merge/confirm'),
        { mergeToken: initiateRes.data.mergeToken },
        {
          withCredentials: true,
          headers,
        },
      )

      clearLinkConflictSearchParams()
      setLinkConflict(null)
      await fetchIdentities()

      const label = PROVIDER_META_MAP[linkConflict.provider]?.label ?? linkConflict.provider
      setSuccess(`${label} is now connected after merging the duplicate account.`)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string; hint?: string } | undefined)
        setError(msg?.error ?? msg?.hint ?? 'Failed to merge the duplicate account.')
      } else {
        setError('Unexpected error.')
      }
    } finally {
      setActionPending(null)
    }
  }

  function dismissLinkConflict() {
    clearLinkConflictSearchParams()
    setLinkConflict(null)
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

  // Redirect unauthenticated visitors to the home page.
  if (!user) {
    return <Navigate to="/" replace />
  }

  return (
    <div className={styles.page}>
      <Navbar user={user} />
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.heading}>Settings</h1>
          <p className={styles.subheading}>Manage your account and connected login methods.</p>

          {linkConflict && (
            <section className={styles.conflictBox}>
              <h2 className={styles.conflictTitle}>Account merge required</h2>
              <p className={styles.conflictText}>
                This {PROVIDER_META_MAP[linkConflict.provider]?.label ?? linkConflict.provider} account is already connected to another Leaflet account.
                Merge that duplicate account into your current account to keep both login methods and any saved data together.
              </p>
              <div className={styles.conflictActions}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleMergeConflict}
                  disabled={actionPending !== null}
                >
                  {actionPending === 'merge' ? 'Merging…' : 'Merge accounts'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={dismissLinkConflict}
                  disabled={actionPending !== null}
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}

          {success && <div className={styles.success}>{success}</div>}
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
              availableProviders.map((name) => {
                const meta = PROVIDER_META_MAP[name]
                if (!meta) return null
                const { label, icon } = meta
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
