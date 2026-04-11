import { useRouteError, isRouteErrorResponse, Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import styles from './ErrorPage.module.css'

interface ErrorPageProps {
  statusCode?: number;
  message?: string;
}

export default function ErrorPage({ statusCode, message }: ErrorPageProps = {}) {
  const routeError = useRouteError?.()

  const code = statusCode ?? (isRouteErrorResponse(routeError) ? routeError.status : 500)
  const text = message ?? (
    isRouteErrorResponse(routeError)
      ? routeError.statusText
      : code === 404
        ? 'Page not found'
        : 'Something went wrong'
  )

  const is404 = code === 404

  return (
    <div className={styles.page}>
      <Navbar />
      <main className={styles.main}>
        <div className={`card ${styles.card}`}>
          <div className={styles.icon} aria-hidden="true">
            {is404 ? '🍃' : '🌿'}
          </div>
          <p className={styles.code}>{code}</p>
          <h1 className={styles.title}>{text}</h1>
          <p className={styles.sub}>
            {is404
              ? 'The page you are looking for does not exist or has been moved.'
              : 'An unexpected error occurred. Please try again.'}
          </p>
          <div className={styles.actions}>
            {!is404 && (
              <button
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                ↺ Retry
              </button>
            )}
            <Link to="/" className="btn btn-primary">
              🌱 Go home
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
