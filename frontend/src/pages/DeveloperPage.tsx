import { useEffect, useState } from 'react'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import Navbar from '../components/Navbar'
import { MISS, fetchMe, meCache, type AuthUser } from '../authCache'
import { apiUrl } from '../urls'
import styles from './DeveloperPage.module.css'

export default function DeveloperPage() {
  const cachedUser = meCache.get()
  const [user, setUser] = useState<AuthUser | null>(cachedUser === MISS ? null : cachedUser)
  const [authLoading, setAuthLoading] = useState(cachedUser === MISS)
  const apiBase = new URL(apiUrl(''), window.location.origin).toString().replace(/\/$/, '')
  const openApiUrl = apiUrl('/openapi.json')

  useEffect(() => {
    if (cachedUser !== MISS) return

    let cancelled = false

    void fetchMe()
      .then((authUser) => {
        if (!cancelled) setUser(authUser)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [cachedUser])

  return (
    <div className={styles.page}>
      <Navbar user={user} loading={authLoading} />

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
          <SwaggerUI
            url={openApiUrl}
            docExpansion="list"
            defaultModelsExpandDepth={-1}
          />
        </div>
      </div>
    </div>
  )
}
