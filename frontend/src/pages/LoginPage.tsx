import { useSearchParams } from 'react-router-dom'
import AuthProviderList from '../components/AuthProviderList'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('returnTo') ?? undefined

  return (
    <main className="page-container">
      <section className={`card ${styles.card}`}>
        <p className={styles.eyebrow}>First-party sign-in</p>
        <h1 className={styles.title}>Sign in to Leaflet</h1>
        <p className={styles.subtitle}>
          Choose a provider to continue and Leaflet will send you back to your requested page after the auth callback completes.
        </p>

        <AuthProviderList returnTo={returnTo} />

        <p className={styles.note}>
          If authentication fails after the provider round-trip, Leaflet redirects back to the same destination with <code>auth=failed</code>.
        </p>
      </section>
    </main>
  )
}
