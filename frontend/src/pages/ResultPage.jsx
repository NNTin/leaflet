import React, { useRef, useState } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { QRCodeCanvas } from 'qrcode.react'
import Navbar from '../components/Navbar'
import styles from './ResultPage.module.css'

export default function ResultPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const qrRef = useRef(null)

  if (!state?.shortUrl) {
    navigate('/')
    return null
  }

  const { shortUrl, shortCode, expiresAt } = state

  function copyUrl() {
    navigator.clipboard.writeText(shortUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function downloadQR() {
    const canvas = qrRef.current?.querySelector('canvas')
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `leaflet-${shortCode}.png`
    a.click()
  }

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Never'

  return (
    <div className={styles.page}>
      <Navbar />

      <main className={styles.main}>
        <div className={`card ${styles.card}`}>
          <div className={styles.successIcon}>✅</div>
          <h1 className={styles.title}>Your link is ready!</h1>

          <div className={styles.urlBox}>
            <a
              href={shortUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.shortUrl}
            >
              {shortUrl}
            </a>
            <button
              onClick={copyUrl}
              className={`btn ${copied ? 'btn-secondary' : 'btn-primary'} ${styles.copyBtn}`}
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>

          <div className={styles.meta}>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Expires:</span>
              {expiry}
            </span>
          </div>

          <div className={styles.qrSection} ref={qrRef}>
            <p className={styles.qrTitle}>QR Code</p>
            <div className={styles.qrWrapper}>
              <QRCodeCanvas
                value={shortUrl}
                size={180}
                bgColor="#ffffff"
                fgColor="#1b5e20"
                level="M"
                includeMargin
              />
            </div>
            <button onClick={downloadQR} className={`btn btn-secondary ${styles.dlBtn}`}>
              ⬇️ Download QR
            </button>
          </div>

          <Link to="/" className={`btn btn-secondary ${styles.anotherBtn}`}>
            ✂️ Shorten another URL
          </Link>
        </div>
      </main>
    </div>
  )
}
