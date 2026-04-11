import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import LoadingSpinner from './components/LoadingSpinner'

const HomePage = lazy(() => import('./pages/HomePage'))
const ResultPage = lazy(() => import('./pages/ResultPage'))
const ExpiredPage = lazy(() => import('./pages/ExpiredPage'))
const ErrorPage = lazy(() => import('./pages/ErrorPage'))
const RedirectPage = lazy(() => import('./pages/RedirectPage'))
const DeveloperPage = lazy(() => import('./pages/DeveloperPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner fullPage />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/result" element={<ResultPage />} />
        <Route path="/expired" element={<ExpiredPage />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route path="/s/:code" element={<RedirectPage />} />
        <Route path="/developer" element={<DeveloperPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<ErrorPage statusCode={404} message="Page not found" />} />
      </Routes>
    </Suspense>
  )
}
