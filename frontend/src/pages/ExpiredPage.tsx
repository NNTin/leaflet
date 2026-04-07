import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import styles from './ExpiredPage.module.css'

export default function ExpiredPage() {
  return (
    <div className={styles.page}>
      <Navbar />
      <main className={styles.main}>
        <div className={`card ${styles.card}`}>
          <div className={styles.icon}>🍂</div>
          <h1 className={styles.title}>Link not found</h1>
          <p className={styles.message}>
            This link may have expired or does not exist.
          </p>
          <p className={styles.sub}>
            The short link you followed is no longer active. Short links on
            Leaflet expire automatically to protect privacy.
          </p>
          <Link to="/" className={`btn btn-primary ${styles.cta}`}>
            🌱 Create a new short link
          </Link>
        </div>
      </main>
    </div>
  )
}
