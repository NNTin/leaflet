import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { csrfHeaders } from '../api'
import { meCache, providersCache } from '../authCache'
import { authUrl } from '../urls'
import styles from './Navbar.module.css'
import LoginModal from './LoginModal'

interface NavbarUser {
  username: string;
  role: string;
}

interface NavbarProps {
  user?: NavbarUser | null;
  loading?: boolean;
  onLogout?: () => void;
}

export default function Navbar({ user, loading = false, onLogout }: NavbarProps) {
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)

  function handleLogout() {
    meCache.clear()
    providersCache.clear()

    if (onLogout) {
      onLogout()
    } else {
      csrfHeaders()
        .then(headers => fetch(authUrl('/logout'), { method: 'POST', credentials: 'include', headers }))
        .finally(() => navigate('/'))
    }
  }

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.inner}>
          <Link to="/" className={styles.logo}>
            <span className={styles.logoIcon}>🌱</span>
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
      </nav>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
