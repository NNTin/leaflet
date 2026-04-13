import { useEffect, useRef } from 'react'
import AuthProviderList from './AuthProviderList'
import styles from './LoginModal.module.css'

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)

  // Close on Escape key.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Set initial focus on the dialog when it opens.
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === backdropRef.current) onClose()
  }

  return (
    <div
      className={styles.backdrop}
      ref={backdropRef}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-modal-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id="login-modal-title" className={styles.title}>Sign in to Leaflet</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className={styles.subtitle}>
          Choose a provider to continue
        </p>
        <AuthProviderList returnTo={window.location.href} />
      </div>
    </div>
  )
}
