import React, { useEffect } from 'react'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import Navbar from '../components/Navbar'
import styles from './DeveloperPage.module.css'

export default function DeveloperPage() {
  const apiBase = window.location.origin

  return (
    <div className={styles.page}>
      <Navbar />

      <div className={`page-container-wide ${styles.content}`}>
        <header className={styles.header}>
          <h1 className={styles.title}>Developer API</h1>
          <p className={styles.description}>
            Leaflet exposes a simple REST API for creating and managing short
            links programmatically. All endpoints are under{' '}
            <code className={styles.code}>{apiBase}/api</code>.
          </p>
          <div className={styles.infoRow}>
            <div className={styles.infoCard}>
              <span className={styles.infoLabel}>Base URL</span>
              <code className={styles.infoValue}>{apiBase}/api</code>
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
            url="/api/openapi.json"
            docExpansion="list"
            defaultModelsExpandDepth={-1}
          />
        </div>
      </div>
    </div>
  )
}
