import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../session'
import styles from './Navbar.module.css'
import LoginModal from './LoginModal'

export default function Navbar() {
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)
  const { user, loading, logout } = useSession()

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
