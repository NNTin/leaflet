import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { apiUrl } from '../urls'
import styles from './DeveloperPage.module.css'

export default function DeveloperPage() {
  const apiBase = new URL(apiUrl(''), window.location.origin).toString().replace(/\/$/, '')
  const openApiUrl = apiUrl('/openapi.json')

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
        <SwaggerUI
          url={openApiUrl}
          docExpansion="list"
          defaultModelsExpandDepth={-1}
        />
      </div>
    </div>
  )
}
