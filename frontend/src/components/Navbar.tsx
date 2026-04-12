import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../session'
import { useCountdown, formatMMSS } from '../rateLimit'
import styles from './Navbar.module.css'
import LoginModal from './LoginModal'

function RateLimitIndicator({ retryDeadline }: { retryDeadline: number }) {
  const countdown = useCountdown(retryDeadline)
  const [visible, setVisible] = useState(false)

  const label = countdown.isExpired
    ? 'Auth rate limited. Retrying…'
    : `Auth rate limited. Retrying in ${formatMMSS(countdown.msLeft)}`

  return (
    <div
      className={styles.rateLimitWrapper}
      tabIndex={0}
      role="status"
      aria-label={label}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span className={styles.rateLimitDot} aria-hidden="true" />
      {visible && (
        <div className={styles.rateLimitTooltip} role="tooltip">
          <strong>Auth rate limited</strong>
          <span>
            {countdown.isExpired ? 'Retrying…' : `Retrying in ${formatMMSS(countdown.msLeft)}`}
          </span>
        </div>
      )}
    </div>
  )
}

export default function Navbar() {
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)
  const { user, loading, meRateLimited, logout } = useSession()

  function handleLogout() {
    void logout().finally(() => navigate('/'))
  }

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.inner}>
          <Link to="/" className={styles.logo}>
            <span className={styles.logoIcon}>🌱💌</span>
            <span className={styles.logoText}>Leaflet</span>
          </Link>

          <div className={styles.links}>
            <Link to="/developer" className={styles.link}>
              Developer API
            </Link>

            {user?.role === 'admin' && (
              <Link to="/admin" className={styles.link}>
                Admin
              </Link>
            )}

            <div className={styles.authArea}>
              {meRateLimited && (
                <RateLimitIndicator retryDeadline={meRateLimited.retryDeadline} />
              )}

              {loading ? (
                <div className={styles.authPlaceholder} aria-hidden="true" />
              ) : user ? (
                <div className={styles.userArea}>
                  <span className={styles.username}>
                    {user.username}
                    {user.role !== 'user' && (
                      <span className={styles.badge}>{user.role}</span>
                    )}
                  </span>
                  <Link to="/settings" className={styles.link}>
                    Settings
                  </Link>
                  <button onClick={handleLogout} className="btn btn-secondary btn-sm">
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowLogin(true)}
                  className="btn btn-primary btn-sm"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
