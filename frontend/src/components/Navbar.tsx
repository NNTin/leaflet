import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styles from './Navbar.module.css'

interface NavbarUser {
  username: string;
  role: string;
}

interface NavbarProps {
  user?: NavbarUser | null;
  onLogout?: () => void;
}

export default function Navbar({ user, onLogout }: NavbarProps) {
  const navigate = useNavigate()

  function handleLogout() {
    if (onLogout) {
      onLogout()
    } else {
      fetch('/auth/logout', { method: 'POST', credentials: 'include' })
        .finally(() => navigate('/'))
    }
  }

  return (
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

          {user ? (
            <div className={styles.userArea}>
              <span className={styles.username}>
                {user.username}
                {user.role !== 'user' && (
                  <span className={styles.badge}>{user.role}</span>
                )}
              </span>
              <button onClick={handleLogout} className="btn btn-secondary btn-sm">
                Logout
              </button>
            </div>
          ) : (
            <a href="/auth/github" className="btn btn-primary btn-sm">
              Login with GitHub
            </a>
          )}
        </div>
      </div>
    </nav>
  )
}
