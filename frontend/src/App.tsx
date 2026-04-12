import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import LoadingSpinner from './components/LoadingSpinner'
import { SessionProvider } from './session'

const HomePage = lazy(() => import('./pages/HomePage'))
const ResultPage = lazy(() => import('./pages/ResultPage'))
const ExpiredPage = lazy(() => import('./pages/ExpiredPage'))
const ErrorPage = lazy(() => import('./pages/ErrorPage'))
const RedirectPage = lazy(() => import('./pages/RedirectPage'))
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner fullPage />}>
      <Routes>
        <Route path="/s/:code" element={<RedirectPage />} />
        <Route
          element={
            <SessionProvider>
              <AppLayout />
            </SessionProvider>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/result" element={<ResultPage />} />
          <Route path="/expired" element={<ExpiredPage />} />
          <Route path="/error" element={<ErrorPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<ErrorPage statusCode={404} message="Page not found" />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
