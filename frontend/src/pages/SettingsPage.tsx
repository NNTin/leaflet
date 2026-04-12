import { useState, useEffect, useCallback, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import axios from 'axios'
import { authUrl } from '../urls'
import { csrfHeaders } from '../api'
import { providersCache, MISS } from '../authCache'
import { PROVIDER_META_MAP } from '../providers'
import { useSession } from '../session'
import styles from './SettingsPage.module.css'

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
  const { user, loading, clearSession } = useSession()
  const [identities, setIdentities] = useState<Identity[]>([])
  const [loadingIdentities, setLoadingIdentities] = useState(false)
  const [availableProviders, setAvailableProviders] = useState<string[] | null>(null)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [linkConflict, setLinkConflict] = useState<LinkConflict | null>(() => readLinkConflict())
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const deleteInputRef = useRef<HTMLInputElement>(null)

  // Close delete modal on Escape key.
  useEffect(() => {
    if (!showDeleteModal) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !deleting) closeDeleteModal()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [showDeleteModal, deleting])

  // Fetch which providers are configured on this server (with cache, proper error handling).
  useEffect(() => {
    if (!user) return

    const cached = providersCache.get()
    if (cached !== MISS) {
      setAvailableProviders(cached)
      return
    }

    axios
      .get<{ name: string }[]>(authUrl('/providers'), { withCredentials: true })
      .then((res) => {
        const names = res.data.map((p) => p.name)
        providersCache.set(names)
        setAvailableProviders(names)
        setProvidersError(null)
      })
      .catch((err) => {
        if (axios.isAxiosError(err) && err.response?.status === 429) {
          setProvidersError('You are being rate limited. Please try again shortly.')
        } else {
          setProvidersError('Could not load connected account options. Please try again.')
        }
        setAvailableProviders(null)
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

  // Account deletion handlers.
  function openDeleteModal() {
    setDeleteConfirm('')
    setShowDeleteModal(true)
    setTimeout(() => deleteInputRef.current?.focus(), 50)
  }

  function closeDeleteModal() {
    setShowDeleteModal(false)
    setDeleteConfirm('')
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE' || deleting) return
    setDeleting(true)
    try {
      const headers = await csrfHeaders()
      await axios.delete(authUrl('/me'), { withCredentials: true, headers })
      clearSession()
      window.location.href = '/'
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: string })?.error
        setError(msg ?? 'Failed to delete account.')
      } else {
        setError('Unexpected error.')
      }
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  const connectedProviders = new Set(identities.map((i) => i.provider))

  if (loading) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>Loading…</div>
      </main>
    )
  }

  // Redirect unauthenticated visitors to the home page.
  if (!user) {
    return <Navigate to="/" replace />
  }

  return (
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

            {providersError && (
              <div className={styles.error}>{providersError}</div>
            )}

            {loadingIdentities ? (
              <div className={styles.loading}>Loading…</div>
            ) : (
              availableProviders !== null && availableProviders.map((name) => {
                const meta = PROVIDER_META_MAP[name]
                if (!meta) return null
                const { label, icon: IconComponent } = meta
                const identity = identities.find((i) => i.provider === name)
                const isConnected = connectedProviders.has(name)
                const isLastIdentity = identities.length <= 1

                return (
                  <div key={name} className={styles.providerRow}>
                    <div className={styles.providerInfo}>
                      <span className={styles.providerIcon} aria-hidden="true">
                        <IconComponent size={20} aria-hidden={true} />
                      </span>
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

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span>⚠️</span>
              <span className={styles.sectionTitle}>Danger Zone</span>
            </div>
            <p className={styles.dangerDescription}>
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button
              className="btn btn-danger btn-sm"
              onClick={openDeleteModal}
              disabled={actionPending !== null}
            >
              Delete Account
            </button>
          </section>
      </div>

      {showDeleteModal && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) closeDeleteModal()
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
            <h2 id="delete-modal-title" className={styles.modalTitle}>Delete Account</h2>
            <p className={styles.modalBody}>
              This will permanently delete your account, all connected identities, and any associated data.
              <strong> This action cannot be undone.</strong>
            </p>
            <p className={styles.modalBody}>
              Type <strong>DELETE</strong> to confirm:
            </p>
            <input
              ref={deleteInputRef}
              type="text"
              className={styles.deleteInput}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm account deletion"
            />
            <div className={styles.modalActions}>
              <button
                className="btn btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleteConfirm !== 'DELETE' || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete my account'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={closeDeleteModal}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
