import { Link, useNavigate } from 'react-router-dom'
import { csrfHeaders } from '../api'
import { authUrl } from '../urls'
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
      csrfHeaders()
        .then(headers => fetch(authUrl('/logout'), { method: 'POST', credentials: 'include', headers }))
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
              <Link to="/settings" className={styles.link}>
                Settings
              </Link>
              <button onClick={handleLogout} className="btn btn-secondary btn-sm">
                Logout
              </button>
            </div>
          ) : (
            <a href={authUrl('/github', window.location.href)} className="btn btn-primary btn-sm">
              Login with GitHub
            </a>
          )}
        </div>
      </div>
    </nav>
  )
}
